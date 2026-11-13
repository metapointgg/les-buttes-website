// An owner can cancel an unpaid production booking only after SumUp confirms
// that its live checkout can no longer accept payment. Inventory is released
// atomically and only when every slot still belongs to this booking.
import {randomUUID} from 'node:crypto';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient} from '@aws-sdk/client-ssm';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {createVerifiedProductionSumUpClient} from './sumup-production-runtime.mjs';
import {productionCheckoutEnabled} from './production-booking-checkout-runtime.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=86400000;
const allowedUnits=new Set(['geranium','honeysuckle']);
const date=(s)=>{
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Invalid stay dates');
 const ms=Date.parse(s+'T00:00:00.000Z');
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==s)throw Error('Invalid stay dates');
 return ms;
};
function occupiedSlots(booking){
 const start=date(booking.start),end=date(booking.end),n=(end-start)/DAY;
 if(!Number.isSafeInteger(n)||n<7||n>27||n%7!==0||new Date(start).getUTCDay()!==6||!Array.isArray(booking.units)||
    booking.units.length<1||booking.units.length>2||
    new Set(booking.units).size!==booking.units.length||
    booking.units.some(u=>!allowedUnits.has(u)))
  throw Error('Invalid booking inventory');
 return booking.units.flatMap(unit=>Array.from({length:n},(_,i)=>({
  PK:'UNIT#'+unit,SK:'DATE#'+new Date(start+i*DAY).toISOString().slice(0,10)
 })));
}
function matchesCheckout(item,checkout,merchant){
 return item?.id===checkout.checkoutId &&
  item?.checkout_reference===checkout.reference &&
  item?.merchant_code===merchant &&item?.currency==='GBP' &&
  Number.isSafeInteger(Math.round(Number(item.amount)*100)) &&
  Math.round(Number(item.amount)*100)===checkout.amountPence &&
  (!Array.isArray(item.transactions)||
   !item.transactions.some(t=>t.status==='SUCCESSFUL'||t.status==='PAID'));
}
export async function cancelUnpaidProductionBooking({
 db,table,bookingId,identity,reason,env=process.env,
 clientFactory=createVerifiedProductionSumUpClient,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 nowEpoch=Math.floor(Date.now()/1000)
}={}){
 if(!db?.send||table!==env.BOOKINGS_TABLE||!ID.test(bookingId??'')||
    !productionCheckoutEnabled(env)||env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'||
    identity?.role!=='owner'||!identity.subject?.trim()||
    typeof reason!=='string'||reason.trim().length<5||reason.length>1000||
    !Number.isSafeInteger(nowEpoch)||nowEpoch<0)
  throw Error('Unpaid production cancellation unavailable');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(booking?.id!==bookingId||booking.source!=='direct'||booking.synthetic===true||
    booking.GSI1PK!=='BOOKING_REQUESTS'||
    booking.status!=='APPROVED_AWAITING_PAYMENT'||
    booking.reservationStatus!=='AWAITING_PAYMENT'||
    booking.paidAt!==undefined||booking.paymentTransactionId!==undefined)
  throw Error('Only an unpaid approved direct booking can be cancelled');
 const slots=occupiedSlots(booking);
 const amountPence=Math.round(Number(booking.approvedAmountGBP)*100);
 if(!Number.isSafeInteger(amountPence)||amountPence<1||
    Math.abs(Number(booking.approvedAmountGBP)*100-amountPence)>0.000001)
  throw Error('Invalid approved booking amount');
 const checkout=await readRegisteredCheckout({db,table,bookingId});
 if(checkout?.status!=='PENDING'||checkout.bookingId!==bookingId||
    checkout.amountPence!==amountPence||checkout.currency!=='GBP'||
    typeof checkout.reference!=='string'||typeof checkout.checkoutId!=='string')
  throw Error('Pending registered live checkout required');
 const ssm=ssmFactory();
 try{
  const sumup=await clientFactory({ssm,env});
  if(sumup.merchantCode!=='M9BE4KMN')throw Error('Approved live merchant required');
  const before=await sumup.retrieveCheckout(checkout.checkoutId);
  if(!matchesCheckout(before,checkout,sumup.merchantCode)||
     !['PENDING','EXPIRED'].includes(before.status))
   throw Error('Checkout may have been paid or provider evidence is incomplete');
  if(before.status==='PENDING')await sumup.deactivateCheckout(checkout.checkoutId);
  // Independently retrieve the checkout after deactivation, including
  // when it was already expired. Never release solely on DELETE response.
  const after=await sumup.retrieveCheckout(checkout.checkoutId);
  if(!matchesCheckout(after,checkout,sumup.merchantCode)||after.status!=='EXPIRED')
   throw Error('Provider did not verify that payment is impossible');
 }finally{ssm.destroy?.();}
 const timestamp=new Date(nowEpoch*1000).toISOString();
 const auditId=randomUUID(),why=reason.trim();
 const actions=[
  {Update:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},
   UpdateExpression:'SET #status=:cancelled,reservationStatus=:cancelled,cancelReason=:reason,cancelledAt=:at,updatedAt=:at,lastManagementActor=:actor,lastManagementAction=:action,expiresAt=:retention',
   ConditionExpression:'#status=:approved AND reservationStatus=:awaiting AND id=:id AND #source=:direct AND #units=:units AND #start=:start AND #end=:end AND approvedAmountGBP=:amount AND attribute_not_exists(paidAt) AND attribute_not_exists(paymentTransactionId)',
   ExpressionAttributeNames:{'#status':'status','#source':'source','#units':'units','#start':'start','#end':'end'},
   ExpressionAttributeValues:{':cancelled':'CANCELLED',':approved':'APPROVED_AWAITING_PAYMENT',
    ':awaiting':'AWAITING_PAYMENT',':id':bookingId,':direct':'direct',':units':booking.units,
    ':start':booking.start,':end':booking.end,':amount':booking.approvedAmountGBP,
    ':reason':why,':at':timestamp,':actor':identity.subject,
    ':action':'cancel_unpaid_checkout',':retention':nowEpoch+90*86400}}},
  {Update:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'PAYMENT#CHECKOUT'},
   UpdateExpression:'SET #status=:expired,deactivatedAt=:at,deactivationReason=:reason',
   ConditionExpression:'#status=:pending AND bookingId=:id AND checkoutId=:checkout AND amountPence=:amount AND currency=:currency',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':expired':'EXPIRED',':pending':'PENDING',
    ':id':bookingId,':checkout':checkout.checkoutId,':amount':amountPence,
    ':currency':'GBP',':at':timestamp,':reason':why}}},
  ...slots.map(key=>({Delete:{TableName:table,Key:key,
   ConditionExpression:'id=:id',ExpressionAttributeValues:{':id':bookingId}}})),
  {Put:{TableName:table,Item:{PK:'BOOKING#'+bookingId,
   SK:'AUDIT#'+timestamp+'#'+auditId,id:auditId,bookingId,
   action:'cancel_unpaid_checkout',from:'APPROVED_AWAITING_PAYMENT',to:'CANCELLED',
   actor:identity.subject,recordedAt:timestamp,reason:why,
   paymentStatus:'PROVIDER_EXPIRED',refundInitiated:false,affectedNights:slots.length},
   ConditionExpression:'attribute_not_exists(PK)'}}
 ];
 await db.send(new TransactWriteCommand({TransactItems:actions,ClientRequestToken:auditId}));
 return {bookingId,status:'CANCELLED',paymentCheckout:'EXPIRED',
  affectedNights:slots.length,refundInitiated:false,auditId};
}
