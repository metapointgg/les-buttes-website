// Internal, provider-verified production payment follow-up. This function
// NEVER accepts a browser or webhook payment assertion and is disabled by default.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {productionReconciliationEnabled,reconcileOwnerLivePayment} from './production-payment-reconciliation-runtime.mjs';
import {dispatchProductionBookingLifecycleEmail} from './booking-production-email-dispatch.mjs';
import {createProductionSesTransport} from './booking-production-ses-transport.mjs';
import {productionEmailGate} from './production-integration-gates.mjs';
import {controlledTestBooking} from './controlled-production-test.mjs';
import {processProductionBalance} from './production-balance-reminder-runner.mjs';

const RULE='arn:aws:events:eu-west-2:145608514666:rule/les-buttes-production-payment-reconciliation';
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorisedProductionPaymentSchedule(event,env=process.env){
 return env.BOOKING_ENVIRONMENT==='production'&&env.AWS_REGION==='eu-west-2'&&
  TABLE.test(env.BOOKINGS_TABLE??'')&&
  env.BOOKING_AUTOMATIC_RECONCILIATION_ENABLED==='true'&&
  productionReconciliationEnabled(env)&&productionEmailGate(env)&&
  env.BOOKING_LIFECYCLE_DISPATCH_ENABLED==='true'&&
  event?.source==='aws.events'&&event?.['detail-type']==='Scheduled Event'&&
  event.account==='145608514666'&&event.region==='eu-west-2'&&
  Array.isArray(event.resources)&&event.resources.length===1&&event.resources[0]===RULE;
}

export async function reconcileScheduledProductionPayments(event,{
 env=process.env,db,reconcile=reconcileOwnerLivePayment,
 dispatch=dispatchProductionBookingLifecycleEmail,
 processBalance=processProductionBalance,
 transportFactory=createProductionSesTransport,
 now=()=>Math.floor(Date.now()/1000)
}={}){
 if(!authorisedProductionPaymentSchedule(event,env))throw Error('Production payment schedule disabled');
 const owned=!db;
 db??=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}),{
  marshallOptions:{removeUndefinedValues:true}});
 const result={confirmed:0,pending:0,review:0,notificationReview:0,checked:0,
  balanceChecked:0,balancePaid:0,balancePending:0,balanceReminderSent:0};
 try{
  let cursor,pages=0;
  do{
   const page=await db.send(new QueryCommand({TableName:env.BOOKINGS_TABLE,
    IndexName:'BookingRequestsIndex',KeyConditionExpression:'GSI1PK = :pk',
    ExpressionAttributeValues:{':pk':'BOOKING_REQUESTS'},Limit:100,ExclusiveStartKey:cursor}));
   for(const indexed of page.Items??[]){
    if(!ID.test(indexed.id??''))continue;
    if(indexed.status==='CONFIRMED'){
     const {Item:confirmedBooking}=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,
      Key:{PK:'BOOKING#'+indexed.id,SK:'META'},ConsistentRead:true}));
     if(confirmedBooking?.status==='CONFIRMED'&&confirmedBooking.reservationStatus==='CONFIRMED'&&
        confirmedBooking.paymentStatus==='PARTIALLY_PAID'&&confirmedBooking.balanceDuePence>0){
      result.balanceChecked++;
      try{
       const outcome=await processBalance({db,table:env.BOOKINGS_TABLE,
        booking:confirmedBooking,env,today:new Date(now()*1000).toISOString().slice(0,10)});
       if(outcome.status==='PAID_IN_FULL')result.balancePaid++;
       else if(outcome.status==='PENDING'){
        result.balancePending++;
        if(outcome.notificationStatus==='ACCEPTED_BY_SES_NOT_DELIVERED')result.balanceReminderSent++;
       }
      }catch(error){
       result.review++;
       console.error('PRODUCTION_BALANCE_PROVIDER_OR_EMAIL_REVIEW',confirmedBooking.id,error?.name??'Error');
      }
     }
     continue;
    }
    if(indexed.status!=='APPROVED_AWAITING_PAYMENT')continue;
    const {Item:booking}=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,
     Key:{PK:'BOOKING#'+indexed.id,SK:'META'},ConsistentRead:true}));
    if(!booking||booking.id!==indexed.id||booking.status!=='APPROVED_AWAITING_PAYMENT'||
       booking.reservationStatus!=='AWAITING_PAYMENT'||booking.source!=='direct'||
       booking.synthetic===true)continue;
    if(!Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=now()){
     // Do not release an expired hold until independent provider status has
     // been reviewed; it could have been paid just before the expiry.
     result.review++;
     console.error('PRODUCTION_PAYMENT_HOLD_EXPIRED_REVIEW',booking.id);
     continue;
    }
    const {Item:checkout}=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,
     Key:{PK:'BOOKING#'+booking.id,SK:'PAYMENT#CHECKOUT'},ConsistentRead:true}));
    if(!checkout)continue;
    if(env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'&&
      (!controlledTestBooking(booking)||Number(booking.approvedAmountGBP)!==1))
      continue;
    result.checked++;
    try{
     const confirmed=await reconcile({db,bookingId:booking.id,env,
      identity:{role:'owner',subject:'system:production-scheduled-payment-reconciliation'}});
     if(confirmed?.bookingId!==booking.id||
       !['CONFIRMED','ALREADY_CONFIRMED'].includes(confirmed.status))
      throw Error('Provider payment confirmation unavailable');
     result.confirmed++;
     try{
      const receipt=await dispatch({db,table:env.BOOKINGS_TABLE,bookingId:booking.id,
       type:'confirmed',transport:transportFactory(),env});
      if(!['ACCEPTED_BY_SES_NOT_DELIVERED','ALREADY_CLAIMED'].includes(receipt?.status))
       result.notificationReview++;
     }catch{
      // Durable outbox is responsible for uncertain delivery outcomes.
      result.notificationReview++;
      console.error('PRODUCTION_PAYMENT_EMAIL_REVIEW',booking.id);
     }
    }catch(error){
     if(error?.message==='Payment not verified: Provider has not confirmed payment'){
      result.pending++;
     }else{
      result.review++;
      // Never log provider response or credential-bearing errors.
      console.error('PRODUCTION_PAYMENT_PROVIDER_REVIEW',booking.id,error?.name??'Error');
     }
    }
   }
   cursor=page.LastEvaluatedKey;
   pages++;
  }while(cursor&&pages<20);
  if(cursor)throw Error('Production reconciliation pagination exceeded safe bound');
  console.info('PRODUCTION_PAYMENT_RECONCILIATION_RESULT',result);
  if(result.review||result.notificationReview)
   throw Error('Production payment or confirmation email requires operational review');
  return result;
 }finally{if(owned)db.destroy?.();}
}
