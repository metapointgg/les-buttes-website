import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {createAdminHandler,identityFromGateway} from './booking-admin-http.mjs';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {productionCheckoutEnabled,registerCheckoutWithLiveSumUp} from './production-booking-checkout-runtime.mjs';
import {productionReconciliationEnabled,reconcileOwnerLivePayment} from './production-payment-reconciliation-runtime.mjs';
import {createProductionSesTransport} from './booking-production-ses-transport.mjs';
import {dispatchProductionBookingLifecycleEmail} from './booking-production-email-dispatch.mjs';
import {productionEmailGate} from './production-integration-gates.mjs';
import {controlledTestBooking,TEST_APPROVAL_PENCE} from './controlled-production-test.mjs';
import {deactivateAndReleaseControlledUnpaidBooking} from './production-unpaid-test-deactivation.mjs';
import {reconcileScheduledProductionPayments} from './production-payment-schedule.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error})});
let deployed;
const deploymentAllowed=()=>process.env.BOOKING_ENVIRONMENT==='production'&&TABLE.test(process.env.BOOKINGS_TABLE??'');
const writesEnabled=()=>deploymentAllowed()&&process.env.MANAGEMENT_WRITES_ENABLED==='true'&&process.env.LIVE_BOOKINGS_APPROVED==='true';

export async function handler(event){
 if(!deploymentAllowed())return reply(503,'Production booking management unavailable');
 if(event?.source==='aws.events'||event?.['detail-type']==='Scheduled Event')
  return reconcileScheduledProductionPayments(event);
 const path=event?.rawPath??'';
 if(!path.startsWith('/admin/production/'))return reply(404,'Not found');
 if(!event?.requestContext?.authorizer?.jwt?.claims)return reply(403,'Forbidden');
 if(!deployed){
  const table=process.env.BOOKINGS_TABLE;
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}),{marshallOptions:{removeUndefinedValues:true}});
  const notify=async(bookingId,type)=>{
   if(!productionEmailGate(process.env)||process.env.BOOKING_LIFECYCLE_DISPATCH_ENABLED!=='true')return 'DISABLED';
   try{return (await dispatchProductionBookingLifecycleEmail({db,table,bookingId,type,
    transport:createProductionSesTransport(),env:process.env})).status;}
   catch{console.error('PRODUCTION_LIFECYCLE_NOTIFICATION_RECONCILIATION_REQUIRED',bookingId,type);return 'RECONCILIATION_REQUIRED';}
  };
  const reader=createReadOnlyAdminReader({bookingIndex:'BookingRequestsIndex',authorise:async request=>identityFromGateway(request)});
  deployed=createAdminHandler({
   reader,deploymentAllowed,writeDeploymentAllowed:deploymentAllowed,writeEnabled:writesEnabled,
   approvalEnabled:()=>writesEnabled()&&process.env.MANAGEMENT_APPROVAL_ENABLED==='true',
   checkoutEnabled:()=>productionCheckoutEnabled(process.env),
   reconciliationEnabled:()=>productionReconciliationEnabled(process.env),
   deactivationEnabled:()=>process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'&&
     productionCheckoutEnabled(process.env),
   deactivateCheckout:async args=>{
    const result=await deactivateAndReleaseControlledUnpaidBooking({db,table,...args,env:process.env});
    return {...result,notificationStatus:await notify(args.bookingId,'cancelled')};
   },
   registerCheckout:async args=>{
    if(process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'){
     const {Item:booking}=await db.send(new GetCommand({TableName:table,
      Key:{PK:'BOOKING#'+args.bookingId,SK:'META'},ConsistentRead:true}));
     if(!controlledTestBooking(booking)||Number(booking.approvedAmountGBP)!==1)
      throw Error('Only the authorised £1 test checkout is permitted');
    }
    const result=await registerCheckoutWithLiveSumUp({db,...args});
    return {...result,notificationStatus:await notify(args.bookingId,'approval_payment')};
   },
   reconcilePayment:async args=>{
    if(process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'){
     const {Item:booking}=await db.send(new GetCommand({TableName:table,
      Key:{PK:'BOOKING#'+args.bookingId,SK:'META'},ConsistentRead:true}));
     if(!controlledTestBooking(booking)||Number(booking.approvedAmountGBP)!==1)
      throw Error('Only the authorised £1 test payment may be reconciled');
    }
    const result=await reconcileOwnerLivePayment({db,...args});
    return {...result,notificationStatus:await notify(args.bookingId,'confirmed')};
   },
   readCheckout:({bookingId})=>readRegisteredCheckout({db,table,bookingId}),
   writeAction:async args=>{
    if(process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'){
     const {Item:booking}=await db.send(new GetCommand({TableName:table,
      Key:{PK:'BOOKING#'+args.bookingId,SK:'META'},ConsistentRead:true}));
     if(!controlledTestBooking(booking))throw Error('Controlled production test booking required');
     if(args.action==='approve'&&
       (args.approval?.amountPence!==TEST_APPROVAL_PENCE||
        !String(args.approval?.priceChangeReason??'').includes('Owner-authorised £1 live payment acceptance test')))
      throw Error('Audited £1 production test approval required');
    }
    const result=await executeOwnerTransition({...args,db,table,
     readCancellationPolicy:async version=>(await db.send(new GetCommand({TableName:table,
      Key:{PK:'CONFIG#cancellation#all',SK:'VERSION#'+version},ConsistentRead:true}))).Item??null,
     readBooking:async bookingId=>(await db.send(new GetCommand({TableName:table,
      Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}))).Item??null});
    // Owner approval is durable before contacting SumUp. Register the approved
    // amount once and send the authoritative checkout link via SES outbox.
    // On provider failure, retain the approved booking for manual recovery.
    if(args.action==='approve'){
     let checkoutStatus='OWNER_ACTION_REQUIRED',notificationStatus='NOT_SENT';
     try{
      const checkout=await registerCheckoutWithLiveSumUp({db,bookingId:args.bookingId,
       identity:args.identity});
      if(checkout?.status!=='REGISTERED'||checkout.bookingId!==args.bookingId)
       throw Error('Checkout registration not verified');
      checkoutStatus='REGISTERED';
      notificationStatus=await notify(args.bookingId,'approval_payment');
     }catch(error){
      console.error('PRODUCTION_APPROVAL_CHECKOUT_REVIEW',args.bookingId,error?.name??'Error');
     }
     return {...result,checkoutStatus,notificationStatus};
    }
    const type=args.action==='decline'?'declined':args.action==='cancel'?'cancelled':null;
    return {...result,...(type?{notificationStatus:await notify(args.bookingId,type)}:{})};
   }
  });
 }
 return deployed({...event,rawPath:path.replace('/admin/production/','/admin/')});
}
