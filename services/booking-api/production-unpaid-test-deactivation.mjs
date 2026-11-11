// Only the second, single-use owner test may deactivate a live pending
// checkout. Provider deactivation MUST be verified before releasing any night.
import {randomUUID} from 'node:crypto';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient} from '@aws-sdk/client-ssm';
import {controlledTestBooking} from './controlled-production-test.mjs';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {createVerifiedProductionSumUpClient} from './sumup-production-runtime.mjs';
import {productionCheckoutEnabled} from './production-booking-checkout-runtime.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validProviderCheckout(item,bookingCheckout,merchant){
 return item?.id===bookingCheckout.checkoutId&&
  item?.checkout_reference===bookingCheckout.reference&&
  item?.merchant_code===merchant&&item?.currency==='GBP'&&
  Math.round(Number(item.amount)*100)===100&&
  (!Array.isArray(item.transactions)||!item.transactions.some(t=>t.status==='SUCCESSFUL'));
}
export async function deactivateAndReleaseControlledUnpaidBooking({
 db,table,bookingId,identity,reason,env=process.env,
 clientFactory=createVerifiedProductionSumUpClient,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 nowEpoch=Math.floor(Date.now()/1000)
}={}){
 if(!db?.send||table!==env.BOOKINGS_TABLE||!ID.test(bookingId??'')||
  !productionCheckoutEnabled(env)||env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED!=='true'||
  identity?.role!=='owner'||typeof identity.subject!=='string'||!identity.subject.trim()||
  typeof reason!=='string'||reason.trim().length<5||reason.length>1000||
  !Number.isSafeInteger(nowEpoch))throw Error('Restricted checkout deactivation unavailable');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(!controlledTestBooking(booking)||booking?.id!==bookingId||
  booking.status!=='APPROVED_AWAITING_PAYMENT'||booking.reservationStatus!=='AWAITING_PAYMENT'||
  Number(booking.approvedAmountGBP)!==1||
  booking.paidAt!==undefined||booking.paymentTransactionId!==undefined)
  throw Error('Only the unpaid £1 owner email test can be deactivated');
 const checkout=await readRegisteredCheckout({db,table,bookingId});
 if(checkout?.status!=='PENDING'||checkout.bookingId!==bookingId||
  checkout.amountPence!==100||checkout.currency!=='GBP'||
  typeof checkout.reference!=='string'||typeof checkout.checkoutId!=='string')
  throw Error('Pending registered checkout required');
 const ssm=ssmFactory();
 try{
  const sumup=await clientFactory({ssm,env});
  const merchant=sumup.merchantCode;
  if(merchant!=='M9BE4KMN')throw Error('Live SumUp merchant required');
  const initial=await sumup.retrieveCheckout(checkout.checkoutId);
  if(!validProviderCheckout(initial,checkout,merchant)||
    !['PENDING','EXPIRED'].includes(initial.status))
    throw Error('Checkout already processed or provider identity changed');
  if(initial.status==='PENDING')await sumup.deactivateCheckout(checkout.checkoutId);
  // A separate provider GET is required before releasing any nights.
  const final=await sumup.retrieveCheckout(checkout.checkoutId);
  if(!validProviderCheckout(final,checkout,merchant)||final.status!=='EXPIRED')
   throw Error('Provider did not verify checkout deactivation');
 }finally{ssm.destroy?.();}
 const timestamp=new Date(nowEpoch*1000).toISOString();
 const auditId=randomUUID();
 const nights=Array.from({length:7},(_,i)=>'2027-04-'+String(10+i).padStart(2,'0'));
 const actions=[
  {Update:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},
   UpdateExpression:'SET #status=:cancelled,reservationStatus=:cancelled,cancelReason=:reason,cancelledAt=:at,updatedAt=:at,lastManagementActor=:actor,lastManagementAction=:action,expiresAt=:retention',
   ConditionExpression:'#status=:approved AND reservationStatus=:awaiting AND id=:id AND approvedAmountGBP=:one AND attribute_not_exists(paidAt) AND attribute_not_exists(paymentTransactionId)',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':cancelled':'CANCELLED',':approved':'APPROVED_AWAITING_PAYMENT',':awaiting':'AWAITING_PAYMENT',
    ':id':bookingId,':one':1,':reason':reason.trim(),':at':timestamp,':actor':identity.subject,
    ':action':'deactivate_unpaid_checkout',':retention':nowEpoch+90*86400}}},
  {Update:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'PAYMENT#CHECKOUT'},
   UpdateExpression:'SET #status=:expired,deactivatedAt=:at,deactivationReason=:reason',
   ConditionExpression:'#status=:pending AND bookingId=:id AND checkoutId=:checkout AND amountPence=:amount',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':expired':'EXPIRED',':pending':'PENDING',':id':bookingId,':checkout':checkout.checkoutId,
    ':amount':100,':at':timestamp,':reason':reason.trim()}}},
  ...nights.map(date=>({Delete:{TableName:table,Key:{PK:'UNIT#geranium',SK:'DATE#'+date},
   ConditionExpression:'id=:id',ExpressionAttributeValues:{':id':bookingId}}})),
  {Put:{TableName:table,Item:{PK:'BOOKING#'+bookingId,
   SK:'AUDIT#'+timestamp+'#'+auditId,id:auditId,bookingId,
   action:'deactivate_unpaid_checkout',from:'APPROVED_AWAITING_PAYMENT',to:'CANCELLED',
   actor:identity.subject,recordedAt:timestamp,reason:reason.trim(),
   paymentStatus:'PROVIDER_EXPIRED',refundInitiated:false,affectedNights:7},
   ConditionExpression:'attribute_not_exists(PK)'}}
 ];
 await db.send(new TransactWriteCommand({TransactItems:actions,ClientRequestToken:auditId}));
 return {bookingId,status:'CANCELLED',paymentCheckout:'EXPIRED',affectedNights:7,
  refundInitiated:false,auditId};
}
