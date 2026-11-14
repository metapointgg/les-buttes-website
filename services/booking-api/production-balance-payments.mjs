// Second instalment uses its own permanent provider-creation claim, immutable
// SumUp checkout identity and independently verified reconciliation. The guest
// never supplies an amount or checkout URL.
import {createHash,randomUUID} from 'node:crypto';
import {GetCommand,PutCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {verifySumUpPayment} from './sumup-payment-verification.mjs';
import {productionPaymentsEnabled} from './sumup-production-runtime.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const bookingKey=id=>({PK:'BOOKING#'+id,SK:'META'});
const checkoutKey=id=>({PK:'BOOKING#'+id,SK:'PAYMENT#BALANCE_CHECKOUT'});
const claimKey=id=>({PK:'BOOKING#'+id,SK:'PAYMENT#BALANCE_CREATION_CLAIM'});
export const balanceReference=id=>{
 if(!ID.test(id??''))throw Error('Invalid booking reference');
 return 'lb-'+createHash('sha256').update('balance:'+id.toLowerCase()).digest('hex').slice(0,32);
};
function live({db,table,env,identity}){
 if(!db?.send||!productionPaymentsEnabled({...env,BOOKINGS_TABLE:table})||
   env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'||
   !['owner','system'].includes(identity?.role)||!identity.subject?.trim())
  throw Error('Live balance payment unavailable');
}
function due(booking){
 if(booking?.source!=='direct'||booking.synthetic===true||
   booking.status!=='CONFIRMED'||booking.reservationStatus!=='CONFIRMED'||
   booking.paymentStatus!=='PARTIALLY_PAID'||!Number.isSafeInteger(booking.balanceDuePence)||
   booking.balanceDuePence<1||!Number.isSafeInteger(booking.paidAmountPence)||
   booking.paidAmountPence<1||!booking.paymentTransactionId||
   booking.paymentSchedule?.balancePence!==booking.balanceDuePence||
   booking.paymentSchedule?.totalPence!==booking.balanceDuePence+booking.paidAmountPence)
  throw Error('Booking is not awaiting a verified balance payment');
 return booking.balanceDuePence;
}
const load=async(db,table,id)=>(await db.send(new GetCommand({TableName:table,
 Key:bookingKey(id),ConsistentRead:true}))).Item;
const getCheckout=async(db,table,id)=>(await db.send(new GetCommand({TableName:table,
 Key:checkoutKey(id),ConsistentRead:true}))).Item;
function validateRegistered(checkout,booking,amount){
 if(checkout.bookingId!==booking.id||checkout.amountPence!==amount||
    checkout.currency!=='GBP'||checkout.reference!==balanceReference(booking.id)||
    !['PENDING','PAID','EXPIRED'].includes(checkout.status))
  throw Error('Balance checkout record mismatch');
 return checkout;
}
export async function ensureBalanceCheckout({db,table,bookingId,identity,sumup,env=process.env,
 now=()=>new Date().toISOString()}={}){
 live({db,table,env,identity});
 if(!ID.test(bookingId??'')||!sumup?.createCheckout||!sumup?.listCheckoutsByReference||
    sumup.merchantCode!=='M9BE4KMN')throw Error('Verified live SumUp client required');
 const booking=await load(db,table,bookingId),amount=due(booking);
 const existing=await getCheckout(db,table,bookingId);
 if(existing)return {status:'ALREADY_REGISTERED',checkout:validateRegistered(existing,booking,amount)};
 const prior=(await db.send(new GetCommand({TableName:table,Key:claimKey(bookingId),ConsistentRead:true}))).Item;
 if(prior)throw Error('Balance checkout creation already claimed; reconciliation required');
 const reference=balanceReference(bookingId);
 // Query provider before acquiring a claim; a provider error blocks creation.
 const remote=await sumup.listCheckoutsByReference(reference);
 if(!Array.isArray(remote)||remote.length>1)
  throw Error('Ambiguous balance checkout identity at SumUp');
 const createdAt=now(),claimId=randomUUID();
 await db.send(new PutCommand({TableName:table,
  Item:{...claimKey(bookingId),reference,amountPence:amount,claimId,state:'CLAIMED',actor:identity.subject,createdAt},
  ConditionExpression:'attribute_not_exists(PK)'}));
 let remoteCheckout;
 try{
  remoteCheckout=remote.length===1?remote[0]:
   await sumup.createCheckout({reference,amountPence:amount});
  if(remoteCheckout.reference!==reference||remoteCheckout.amountPence!==amount||
     remoteCheckout.currency!=='GBP'||remoteCheckout.status!=='PENDING'||
     !/^https:\/\/checkout\.sumup\.com\/pay\/c-[0-9a-f-]{36}$/i.test(remoteCheckout.hostedCheckoutUrl||''))
   throw Error('Provider balance checkout does not match booking');
 }catch{
  // Leave the permanent claim: an unknown provider response could have
  // created a chargeable checkout. Never retry automatically.
  throw Error('Balance checkout needs provider reconciliation before retry');
 }
 const record={...checkoutKey(bookingId),bookingId,reference,
  checkoutId:remoteCheckout.checkoutId,amountPence:amount,currency:'GBP',
  status:'PENDING',hostedCheckoutUrl:remoteCheckout.hostedCheckoutUrl,createdAt};
 try{
  await db.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:table,Key:bookingKey(bookingId),
    ConditionExpression:'#status=:confirmed AND reservationStatus=:confirmed AND paymentStatus=:partial AND balanceDuePence=:amount AND paidAmountPence=:deposit AND paymentTransactionId=:first',
    ExpressionAttributeNames:{'#status':'status'},
    ExpressionAttributeValues:{':confirmed':'CONFIRMED',':partial':'PARTIALLY_PAID',':amount':amount,
     ':deposit':booking.paidAmountPence,':first':booking.paymentTransactionId}}},
   {Put:{TableName:table,Item:record,ConditionExpression:'attribute_not_exists(PK)'}}
  ]}));
 }catch{
  throw Error('Balance checkout exists remotely but registration requires review');
 }
 return {status:'REGISTERED',checkout:record};
}
export async function reconcileBalancePayment({db,table,bookingId,identity,sumup,env=process.env,
 now=()=>new Date().toISOString()}={}){
 live({db,table,env,identity});
 if(!ID.test(bookingId??'')||!sumup?.retrieveCheckout||sumup.merchantCode!=='M9BE4KMN')
  throw Error('Verified live SumUp client required');
 const booking=await load(db,table,bookingId);
 if(booking?.status==='CONFIRMED'&&booking.paymentStatus==='PAID_IN_FULL'&&
    booking.balancePaidAt&&booking.balanceTransactionId)
  return {status:'ALREADY_PAID',bookingId,balanceDuePence:0};
 const amount=due(booking),registered=await getCheckout(db,table,bookingId);
 if(!registered||registered.status!=='PENDING')
  throw Error('Registered unpaid balance checkout required');
 validateRegistered(registered,booking,amount);
 const provider=await sumup.retrieveCheckout(registered.checkoutId);
 const evidence=verifySumUpPayment({provider,registered:{...registered,merchantCode:sumup.merchantCode},
  booking:{...booking,reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:amount/100,paymentSchedule:undefined}});
 if(!evidence.verified)throw Error('Balance payment not verified: '+evidence.reason);
 const at=now(),auditId=randomUUID(),total=booking.paidAmountPence+amount;
 await db.send(new TransactWriteCommand({TransactItems:[
  {Update:{TableName:table,Key:bookingKey(bookingId),
   UpdateExpression:'SET paymentStatus=:full, paidAmountPence=:total, balanceDuePence=:zero, balancePaidAt=:at, balanceTransactionId=:tx, updatedAt=:at',
   ConditionExpression:'#status=:confirmed AND reservationStatus=:confirmed AND paymentStatus=:partial AND balanceDuePence=:amount AND paidAmountPence=:deposit AND paymentTransactionId=:first',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':confirmed':'CONFIRMED',':partial':'PARTIALLY_PAID',':full':'PAID_IN_FULL',
    ':total':total,':zero':0,':amount':amount,':deposit':booking.paidAmountPence,
    ':first':booking.paymentTransactionId,':tx':evidence.transactionId,':at':at}}},
  {Update:{TableName:table,Key:checkoutKey(bookingId),
   UpdateExpression:'SET #status=:paid,paidAt=:at,transactionId=:tx',
   ConditionExpression:'#status=:pending AND checkoutId=:checkout AND amountPence=:amount',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':paid':'PAID',':pending':'PENDING',':checkout':registered.checkoutId,
    ':amount':amount,':tx':evidence.transactionId,':at':at}}},
  {Put:{TableName:table,Item:{PK:'PAYMENT_TRANSACTION#'+evidence.transactionId,
   SK:'CONFIRMATION',bookingId,checkoutId:registered.checkoutId,amountPence:amount,
   currency:'GBP',paymentStage:'BALANCE',recordedAt:at},
   ConditionExpression:'attribute_not_exists(PK)'}},
  {Put:{TableName:table,Item:{PK:'BOOKING#'+bookingId,SK:'AUDIT#'+at+'#'+auditId,
   id:auditId,bookingId,action:'balance_payment_confirmed',provider:'sumup',
   amountPence:amount,transactionId:evidence.transactionId,recordedAt:at},
   ConditionExpression:'attribute_not_exists(PK)'}}
 ]}));
 return {status:'PAID_IN_FULL',bookingId,amountPence:amount,totalPaidPence:total,
  balanceDuePence:0,auditId};
}
