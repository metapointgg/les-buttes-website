// LB-07: conditional, durable checkout registration in the authoritative booking table.
// This module deliberately does not create charges or confirm reservations.
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {productionPaymentsEnabled} from './sumup-production-runtime.mjs';

// Live payment writes share the exact environment, table and release gates
// used by the SumUp client. Staging remains independently available.
export function checkoutWriteTableAllowed(table,env=process.env){
 const staging=typeof table==='string'&&table.toLowerCase().includes('staging')&&
  env.BOOKING_ENVIRONMENT!=='production';
 return staging||productionPaymentsEnabled({...env,BOOKINGS_TABLE:table});
}
const ID=/^[0-9a-f-]{36}$/i;
const CHECKOUT=/^[A-Za-z0-9-]{8,100}$/;
const REF=/^[A-Za-z0-9_-]{6,64}$/;
export const checkoutKey=id=>({PK:'BOOKING#'+id,SK:'PAYMENT#CHECKOUT'});
export function validateCheckoutRecord({bookingId,checkout,reference}={}){
 if(!ID.test(bookingId??''))throw Error('Invalid booking ID');
 if(!checkout||!CHECKOUT.test(checkout.checkoutId??'')||!REF.test(reference??'')||
   checkout.reference!==reference||checkout.currency!=='GBP'||
   !Number.isSafeInteger(checkout.amountPence)||checkout.amountPence<1||
   checkout.status!=='PENDING')throw Error('Invalid checkout record');
 const url=new URL(checkout.hostedCheckoutUrl);
 if(url.protocol!=='https:'||url.hostname!=='checkout.sumup.com'||url.username||url.password)
   throw Error('Invalid checkout URL');
 return true;
}
export async function registerCheckout({db,table,bookingId,checkout,reference,nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||!checkoutWriteTableAllowed(table))throw Error('Checkout registration unavailable');
 validateCheckoutRecord({bookingId,checkout,reference});
 const key=checkoutKey(bookingId);
 const record={...key,bookingId,checkoutId:checkout.checkoutId,reference,
   amountPence:checkout.amountPence,currency:'GBP',status:'PENDING',
   hostedCheckoutUrl:checkout.hostedCheckoutUrl,createdAt:new Date(nowEpoch*1000).toISOString()};
 // A checkout can be registered only against the exact approved amount and booking state.
 // The payment record is immutable. A duplicate attempt must read/reconcile the first.
 const items=[
  {ConditionCheck:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},
   ConditionExpression:'#status = :approved AND reservationStatus = :awaiting AND approvedAmountGBP = :amount AND attribute_exists(PK)',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':approved':'APPROVED_AWAITING_PAYMENT',':awaiting':'AWAITING_PAYMENT',':amount':checkout.amountPence/100}}},
  {Put:{TableName:table,Item:record,ConditionExpression:'attribute_not_exists(PK)'}}
 ];
 await db.send(new TransactWriteCommand({TransactItems:items}));
 return record;
}
export async function readRegisteredCheckout({db,table,bookingId}={}){
 if(!db?.send||!table||!ID.test(bookingId??''))throw Error('Invalid checkout lookup');
 return (await db.send(new GetCommand({TableName:table,Key:checkoutKey(bookingId),ConsistentRead:true}))).Item??null;
}
export async function reconcileCheckoutRegistration({db,table,bookingId,checkout,reference}={}){
 validateCheckoutRecord({bookingId,checkout,reference});
 const existing=await readRegisteredCheckout({db,table,bookingId});
 if(!existing)return {status:'UNREGISTERED'};
 if(existing.checkoutId===checkout.checkoutId&&existing.reference===reference&&
   existing.amountPence===checkout.amountPence&&existing.currency==='GBP')
  return {status:'REGISTERED',record:existing};
 return {status:'CONFLICT',record:existing};
}
