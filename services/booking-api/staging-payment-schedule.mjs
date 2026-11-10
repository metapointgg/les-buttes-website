// Internal scheduled reconciliation: no public payment assertions are accepted.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {reconcilePaymentAndNotify} from './booking-payment-confirmation-followup.mjs';
import {createStagingSesTransport} from './booking-staging-ses-transport.mjs';
import {expireApprovedPaymentHold} from './booking-payment-hold-expiry.mjs';
import {dispatchBookingLifecycleEmail} from './booking-confirmation-email-dispatch.mjs';
const RULE='arn:aws:events:eu-west-2:145608514666:rule/les-buttes-sandbox-payment-reconciliation';
export function authorisedPaymentSchedule(event,env=process.env){
 return env.BOOKING_ENVIRONMENT==='staging'&&env.BOOKING_AUTOMATIC_RECONCILIATION_ENABLED==='true'&&
  env.AWS_REGION==='eu-west-2'&&event?.source==='aws.events'&&event['detail-type']==='Scheduled Event'&&
  event.account==='145608514666'&&event.region==='eu-west-2'&&Array.isArray(event.resources)&&
  event.resources.length===1&&event.resources[0]===RULE&&
  /^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(env.BOOKINGS_TABLE??'');
}
export async function reconcileScheduledPayments(event,{env=process.env,db,
 reconcile=reconcilePaymentAndNotify,expire=expireApprovedPaymentHold,
 dispatch=dispatchBookingLifecycleEmail,now=()=>Math.floor(Date.now()/1000)}={}){
 if(!authorisedPaymentSchedule(event,env))throw Error('Scheduled reconciliation disabled');
 const own=!db;
 db??=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
 const counts={confirmed:0,pending:0,review:0,pendingOrReview:0,expired:0};
 try{
  let cursor;
  do{
   const page=await db.send(new QueryCommand({TableName:env.BOOKINGS_TABLE,IndexName:'BookingRequestsIndex',
    KeyConditionExpression:'GSI1PK = :pk',ExpressionAttributeValues:{':pk':'BOOKING_REQUESTS'},ExclusiveStartKey:cursor}));
   for(const indexed of page.Items??[]){
    if(indexed.status!=='APPROVED_AWAITING_PAYMENT')continue;
    const record=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,Key:{PK:'BOOKING#'+indexed.id,SK:'META'},ConsistentRead:true}));
    const candidate=record.Item;
    if(!candidate)continue;
    if(candidate.status!=='APPROVED_AWAITING_PAYMENT'||candidate.synthetic!==true||candidate.guestEmail!=='test@example.invalid')continue;
    const evaluatedAt=now();
    if(!Number.isSafeInteger(candidate.holdExpiresAt)){counts.pendingOrReview++;counts.review++;continue;}
    if(candidate.holdExpiresAt<=evaluatedAt){
     try{
      await expire({db,table:env.BOOKINGS_TABLE,booking:candidate,nowEpoch:evaluatedAt});
      counts.expired++;
      if(env.BOOKING_LIFECYCLE_DISPATCH_ENABLED==='true'){
       try{await dispatch({db,table:env.BOOKINGS_TABLE,bookingId:candidate.id,type:'hold_expired',
        transport:createStagingSesTransport({env}),env});}
       catch{console.error('STAGING_HOLD_EXPIRY_NOTIFICATION_RECONCILIATION_REQUIRED',candidate.id);}
      }
     }catch(error){
      counts.pendingOrReview++;counts.review++;
      console.error('STAGING_HOLD_EXPIRY_REVIEW',candidate.id,
       String(error?.message??error?.name??'unknown').slice(0,240));
     }
     continue;
    }
    const checkout=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,Key:{PK:'BOOKING#'+candidate.id,SK:'PAYMENT#CHECKOUT'},ConsistentRead:true}));
    if(!checkout.Item)continue;
    try{
     await reconcile({db,table:env.BOOKINGS_TABLE,bookingId:candidate.id,env,
      identity:{role:'owner',subject:'system:staging-sandbox-payment-reconciliation'},transport:createStagingSesTransport({env})});
     counts.confirmed++;
    }catch(error){
      const reason=String(error?.message??error?.name??'unknown').slice(0,240);
      counts.pendingOrReview++;
      if(reason==='Payment not verified: Provider has not confirmed payment')counts.pending++;
      else{
       counts.review++;
       console.error('STAGING_PAYMENT_RECONCILIATION_REVIEW',candidate.id,reason);
      }
    }
   }
   cursor=page.LastEvaluatedKey;
  }while(cursor);
  console.info('STAGING_PAYMENT_SCHEDULE_RESULT',counts);
  return counts;
 }finally{if(own)db.destroy?.();}
}
