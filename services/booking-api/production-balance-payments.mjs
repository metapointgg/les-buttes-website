// Second instalment uses its own permanent provider-creation claim, immutable
// SumUp checkout identity and independently verified reconciliation. The guest
// never supplies an amount or checkout URL.
import {createHash,randomUUID} from 'node:crypto';
import {GetCommand,PutCommand,UpdateCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {verifySumUpPayment} from './sumup-payment-verification.mjs';
import {productionPaymentsEnabled} from './sumup-production-runtime.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const bookingKey=id=>({PK:'BOOKING#'+id,SK:'META'});
const checkoutKey=id=>({PK:'BOOKING#'+id,SK:'PAYMENT#BALANCE_CHECKOUT'});
const claimKey=(id,attempt=1)=>({PK:'BOOKING#'+id,
 SK:'PAYMENT#BALANCE_CREATION_CLAIM'+(attempt===1?'':'#'+attempt)});
export const balanceReference=(id,attempt=1)=>{
 if(!ID.test(id??'')||!Number.isSafeInteger(attempt)||attempt<1||attempt>100)
  throw Error('Invalid booking reference or payment attempt');
 return 'lb-'+createHash('sha256').update('balance:'+id.toLowerCase()+':'+attempt).digest('hex').slice(0,32);
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
    checkout.currency!=='GBP'||checkout.reference!==balanceReference(booking.id,checkout.attempt??1)||
    !['PENDING','PAID','EXPIRED'].includes(checkout.status))
  throw Error('Balance checkout record mismatch');
 return checkout;
}
export async function ensureBalanceCheckout({db,table,bookingId,identity,sumup,env=process.env,
 now=()=>new Date().toISOString()}={}){
 live({db,table,env,identity});
 if(!ID.test(bookingId??'')||!sumup?.createCheckout||!sumup?.listCheckoutsByReference||
    !sumup?.retrieveCheckout||!sumup?.deactivateCheckout||
    sumup.merchantCode!=='M9BE4KMN')throw Error('Verified live SumUp client required');
 const booking=await load(db,table,bookingId),amount=due(booking);
 const existing=await getCheckout(db,table,bookingId);
 let attempt=1;
 const at=now(),atEpoch=Date.parse(at);
 if(!Number.isFinite(atEpoch))throw Error('Invalid checkout creation time');
 if(existing){
  validateRegistered(existing,booking,amount);
  if(existing.status==='PAID')throw Error('Balance already settled; reconcile payment record');
  attempt=(existing.attempt??1)+1;
  if(existing.status==='PENDING'){
   const created=Date.parse(existing.createdAt??'');
   if(!Number.isFinite(created)||created>atEpoch)
    throw Error('Checkout creation time missing or invalid');
   // A SumUp hosted session is available for 30 minutes; reuse it for no
   // more than 15 minutes so every button click receives a usable page.
   if(atEpoch-created<15*60*1000)
    return {status:'ALREADY_REGISTERED',checkout:existing};
   const remote=await sumup.retrieveCheckout(existing.checkoutId);
   if(remote?.id!==existing.checkoutId||remote.checkout_reference!==existing.reference||
      remote.merchant_code!==sumup.merchantCode||remote.currency!=='GBP'||
      Math.round(Number(remote.amount)*100)!==amount)
    throw Error('Existing balance checkout provider identity mismatch');
   if(remote.status==='PAID')
    throw Error('Balance checkout was paid; reconciliation required before renewal');
   if(remote.status==='PENDING'){
    await sumup.deactivateCheckout(existing.checkoutId);
    const after=await sumup.retrieveCheckout(existing.checkoutId);
    if(after?.id!==existing.checkoutId||after.checkout_reference!==existing.reference||
       after.merchant_code!==sumup.merchantCode||after.currency!=='GBP'||
       Math.round(Number(after.amount)*100)!==amount||after.status!=='EXPIRED')
     throw Error('Old SumUp session expiry not independently verified');
   }else if(remote.status!=='EXPIRED'){
    throw Error('Old SumUp checkout must be reviewed before renewal');
   }
   await db.send(new UpdateCommand({TableName:table,Key:checkoutKey(bookingId),
    UpdateExpression:'SET #status = :expired, deactivatedAt = :at',
    ConditionExpression:'#status = :pending AND checkoutId = :checkout AND amountPence = :amount',
    ExpressionAttributeNames:{'#status':'status'},
    ExpressionAttributeValues:{':expired':'EXPIRED',':pending':'PENDING',
     ':checkout':existing.checkoutId,':amount':amount,':at':at}}));
  }else if(existing.status!=='EXPIRED'){
   throw Error('Balance checkout state requires owner review');
  }
  if(attempt>100)throw Error('Excessive balance checkout renewals require owner review');
 }
 const reference=balanceReference(bookingId,attempt);
 const prior=(await db.send(new GetCommand({TableName:table,
  Key:claimKey(bookingId,attempt),ConsistentRead:true}))).Item;
 if(prior)throw Error('Balance checkout creation already claimed; reconciliation required');
 // An unknown lookup response or remote duplicate prevents any new checkout.
 const remote=await sumup.listCheckoutsByReference(reference);
 if(!Array.isArray(remote)||remote.length>1)
  throw Error('Ambiguous balance checkout identity at SumUp');
 const claimId=randomUUID();
 await db.send(new PutCommand({TableName:table,
  Item:{...claimKey(bookingId,attempt),reference,amountPence:amount,claimId,
   state:'CLAIMED',actor:identity.subject,createdAt:at},
  ConditionExpression:'attribute_not_exists(PK)'}));
 let checkout;
 try{
  checkout=remote.length===1?remote[0]:
   await sumup.createCheckout({reference,amountPence:amount});
  if(checkout.reference!==reference||checkout.amountPence!==amount||
     checkout.currency!=='GBP'||checkout.status!=='PENDING'||
     !/^https:\/\/checkout\.sumup\.com\/pay\/c-[0-9a-f-]{36}$/i.test(checkout.hostedCheckoutUrl||''))
   throw Error('Provider balance checkout does not match booking');
 }catch{
  // A timeout might have created a live checkout. Never blindly retry after
  // an ambiguous provider response; retain the durable attempt claim.
  throw Error('Balance checkout needs provider reconciliation before retry');
 }
 const record={...checkoutKey(bookingId),bookingId,reference,attempt,
  checkoutId:checkout.checkoutId,amountPence:amount,currency:'GBP',
  status:'PENDING',hostedCheckoutUrl:checkout.hostedCheckoutUrl,createdAt:at};
 try{
  await db.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:table,Key:bookingKey(bookingId),
    ConditionExpression:'#status=:confirmed AND reservationStatus=:confirmed AND paymentStatus=:partial AND balanceDuePence=:amount AND paidAmountPence=:deposit AND paymentTransactionId=:first',
    ExpressionAttributeNames:{'#status':'status'},
    ExpressionAttributeValues:{':confirmed':'CONFIRMED',':partial':'PARTIALLY_PAID',
     ':amount':amount,':deposit':booking.paidAmountPence,':first':booking.paymentTransactionId}}},
   {Put:{TableName:table,Item:record,
    ConditionExpression:existing?'#status = :expired AND checkoutId = :oldId':'attribute_not_exists(PK)',
    ...(existing?{ExpressionAttributeNames:{'#status':'status'},
     ExpressionAttributeValues:{':expired':'EXPIRED',':oldId':existing.checkoutId}}:{})}}
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
 if(!['PAID','PENDING'].includes(provider?.status))
  throw Error('Balance checkout is no longer payable; owner review required');
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
