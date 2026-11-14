// Owner-authenticated, read-only SumUp refund evidence; never issues a refund POST.
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {randomUUID} from 'node:crypto';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pence=value=>{
 const n=Number(value);
 if(!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.000001)
  throw Error('Invalid GBP transaction amount');
 return Math.round(n*100);
};

export function verifyProductionRefundEvidence({booking,transaction,merchantCode}={}){
 if(!booking||!transaction||!ID.test(booking.id??'')||
  booking.source!=='direct'||booking.status!=='CANCELLED'||
  booking.reservationStatus!=='CANCELLED'||booking.refundStatus!=='ASSESSED'||
  !Number.isSafeInteger(booking.refundDuePence)||booking.refundDuePence<1||
  !Number.isSafeInteger(booking.paidAmountPence)||
  booking.refundDuePence>booking.paidAmountPence||
  !ID.test(booking.paymentTransactionId??'')||
  transaction.id!==booking.paymentTransactionId||
  merchantCode!=='M9BE4KMN'||transaction.merchant_code!==merchantCode||
  transaction.currency!=='GBP'||pence(transaction.amount)!==booking.paidAmountPence)
  throw Error('Refund identity or booking mismatch');
 // SumUp can leave the overall transaction SUCCESSFUL after a refund.
 // The completed REFUND events, rather than the overall payment status,
 // provide the authoritative amount returned to the payer.
 if(!['SUCCESSFUL','REFUNDED'].includes(transaction.status)||
    !['SUCCESSFUL','REFUNDED','PAID_OUT'].includes(transaction.simple_status))
  throw Error('SumUp payment status is not eligible for verified refund');
 const sources=[transaction.transaction_events,transaction.events].filter(Array.isArray);
 if(!sources.length)throw Error('Authoritative refund events missing');
 let refundedPence=null,refundCount=0;
 for(const events of sources){
  const refunds=events.filter(event=>(event?.event_type??event?.type)==='REFUND');
  if(!refunds.length)continue;
  if(refunds.some(x=>!['REFUNDED','SUCCESSFUL'].includes(x.status)))
   throw Error('Refund event not complete');
  const amount=refunds.reduce((total,x)=>total+pence(x.amount),0);
  if(refundedPence!==null&&amount!==refundedPence)
   throw Error('Refund event sources disagree');
  refundedPence=amount;
  refundCount=Math.max(refundCount,refunds.length);
 }
 if(!refundCount||refundedPence===null||
    refundedPence<1||refundedPence>booking.refundDuePence)
  throw Error('Verified refund events do not match assessed amount');
 // SumUp may omit refunded_amount even when it includes REFUNDED events.
 // When present, however, it must agree exactly with the event total.
 if(transaction.refunded_amount!==undefined&&transaction.refunded_amount!==null&&
    pence(transaction.refunded_amount)!==refundedPence)
  throw Error('SumUp refund aggregate conflicts with events');
 // Merchant payout deductions are never interpreted as guest refunds.
 return {amountPence:refundedPence,outstandingPence:booking.refundDuePence-refundedPence,
  currency:'GBP',transactionId:booking.paymentTransactionId,refundEvents:refundCount};
}

function verifiedRefundEventAmount(transaction,{id,amountPence,merchantCode}){
 if(transaction?.id!==id||transaction.merchant_code!==merchantCode||
    merchantCode!=='M9BE4KMN'||transaction.currency!=='GBP'||
    pence(transaction.amount)!==amountPence||
    !['SUCCESSFUL','REFUNDED'].includes(transaction.status)||
    !['SUCCESSFUL','REFUNDED','PAID_OUT'].includes(transaction.simple_status))
  throw Error('SumUp instalment identity mismatch');
 const sources=[transaction.transaction_events,transaction.events].filter(Array.isArray);
 if(!sources.length)throw Error('Authoritative instalment event records missing');
 let amount=null,count=0;
 for(const events of sources){
  const refunds=events.filter(x=>(x.event_type??x.type)==='REFUND');
  if(refunds.some(x=>!['REFUNDED','SUCCESSFUL'].includes(x.status)))
   throw Error('Incomplete instalment refund event');
  const total=refunds.reduce((sum,x)=>sum+pence(x.amount),0);
  if(amount!==null&&total!==amount)throw Error('Instalment refund event sources disagree');
  amount=total;count=Math.max(count,refunds.length);
 }
 const refunded=amount??0;
 if(refunded>amountPence||
    transaction.refunded_amount!=null&&pence(transaction.refunded_amount)!==refunded)
  throw Error('Instalment refunded amount conflicts with provider evidence');
 return {refundedPence:refunded,eventCount:count};
}
export async function verifyMultiInstalmentRefundEvidence({booking,fetchTransaction,merchantCode}={}){
 if(!booking||booking.source!=='direct'||booking.status!=='CANCELLED'||
    booking.reservationStatus!=='CANCELLED'||!ID.test(booking.id??'')||
    !ID.test(booking.paymentTransactionId??'')||
    !ID.test(booking.balanceTransactionId??'')||
    booking.balanceTransactionId===booking.paymentTransactionId||
    !Number.isSafeInteger(booking.refundDuePence)||booking.refundDuePence<1||
    !Number.isSafeInteger(booking.paidAmountPence)||
    booking.refundDuePence>booking.paidAmountPence||
    booking.paymentSchedule?.totalPence!==booking.paidAmountPence||
    !Number.isSafeInteger(booking.paymentSchedule.dueNowPence)||
    !Number.isSafeInteger(booking.paymentSchedule.balancePence)||
    booking.paymentSchedule.dueNowPence+booking.paymentSchedule.balancePence!==booking.paidAmountPence||
    typeof fetchTransaction!=='function')
  throw Error('Two-instalment refund booking mismatch');
 const amounts=[booking.paymentSchedule.dueNowPence,booking.paymentSchedule.balancePence];
 const ids=[booking.paymentTransactionId,booking.balanceTransactionId];
 const transactions=await Promise.all(ids.map(id=>fetchTransaction(id)));
 const verified=transactions.map((tx,i)=>verifiedRefundEventAmount(tx,{
  id:ids[i],amountPence:amounts[i],merchantCode}));
 const refunded=verified.reduce((sum,v)=>sum+v.refundedPence,0);
 if(refunded<1||refunded>booking.refundDuePence)
  throw Error('Two-instalment verified refund outside assessed entitlement');
 return {amountPence:refunded,outstandingPence:booking.refundDuePence-refunded,
  currency:'GBP',transactionId:ids[0],transactionIds:ids,
  transactionAmountsPence:amounts,
  refundAmountsPence:verified.map(x=>x.refundedPence),
  refundEvents:verified.reduce((sum,v)=>sum+v.eventCount,0)};
}

export async function reconcileVerifiedProductionRefund({db,table,bookingId,identity,
 fetchTransaction,merchantCode,now=()=>new Date().toISOString()}={}){
 if(!db?.send||!TABLE.test(table??'')||!ID.test(bookingId??'')||
  identity?.role!=='owner'||!identity.subject||typeof fetchTransaction!=='function')
  throw Error('Owner refund reconciliation unavailable');
 const key={PK:'BOOKING#'+bookingId,SK:'META'};
 const booking=(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 if(!booking||booking.id!==bookingId)throw Error('Booking not found');
 if(!['ASSESSED','PARTIALLY_REFUNDED','REFUNDED'].includes(booking.refundStatus))
  throw Error('Refund has not been assessed');
 const verified=booking.balanceTransactionId?
  await verifyMultiInstalmentRefundEvidence({booking,fetchTransaction,merchantCode}):
  verifyProductionRefundEvidence({booking:{...booking,refundStatus:'ASSESSED'},
   transaction:await fetchTransaction(booking.paymentTransactionId),merchantCode});
 const full=verified.outstandingPence===0;
 const previous=booking.refundedAmountPence??0;
 if(booking.refundStatus==='REFUNDED'){
  if(!full||previous!==verified.amountPence)throw Error('Recorded refund amount mismatch');
  return {status:'ALREADY_REFUNDED',bookingId,amountPence:verified.amountPence,outstandingPence:0};
 }
 if(booking.refundStatus==='PARTIALLY_REFUNDED'){
  if(!Number.isSafeInteger(previous)||previous<1||verified.amountPence<previous)
   throw Error('Recorded refund amount mismatch');
  if(previous===verified.amountPence)
   return {status:'ALREADY_PARTIALLY_REFUNDED',bookingId,
    amountPence:previous,outstandingPence:verified.outstandingPence};
 }
 const nextStatus=full?'REFUNDED':'PARTIALLY_REFUNDED';
 const at=now(),auditId=randomUUID();
 if(!/^\d{4}-\d{2}-\d{2}T/.test(at))throw Error('Invalid reconciliation time');
 const claim={PK:'BOOKING#'+bookingId,SK:full?'REFUND#PROVIDER_VERIFIED':'REFUND#PARTIAL_PROVIDER_VERIFIED#'+verified.amountPence,
  bookingId,transactionId:verified.transactionId,
  ...(verified.transactionIds?{transactionIds:verified.transactionIds,
   refundAmountsPence:verified.refundAmountsPence}:{}),
  amountPence:verified.amountPence,
  outstandingPence:verified.outstandingPence,currency:'GBP',state:nextStatus,
  verifiedAt:at,refundEvents:verified.refundEvents};
 const audit={PK:'BOOKING#'+bookingId,SK:'AUDIT#'+at+'#'+auditId,
  id:auditId,bookingId,action:full?'refund_verified':'partial_refund_verified',actor:identity.subject,
  provider:'sumup',amountPence:verified.amountPence,outstandingPence:verified.outstandingPence,
  transactionId:verified.transactionId,recordedAt:at};
 const paymentChecks=(verified.transactionIds??[verified.transactionId]).map((tx,index)=>({
  ConditionCheck:{TableName:table,Key:{PK:'PAYMENT_TRANSACTION#'+tx,SK:'CONFIRMATION'},
   ConditionExpression:'bookingId = :booking AND amountPence = :paid AND currency = :currency'+
     (index===1?' AND paymentStage = :stage':''),
   ExpressionAttributeValues:{':booking':bookingId,
    ':paid':verified.transactionAmountsPence?.[index]??booking.paidAmountPence,
    ':currency':'GBP',...(index===1?{':stage':'BALANCE'}:{})}}}));
 await db.send(new TransactWriteCommand({TransactItems:[
  ...paymentChecks,
  {Update:{TableName:table,Key:key,
   UpdateExpression:'SET refundStatus = :next,refundedAmountPence = :amount,refundOutstandingPence = :outstanding,refundedAt = :at',
   ConditionExpression:'#status = :cancelled AND reservationStatus = :cancelled AND refundStatus = :previous AND refundDuePence = :due AND paymentTransactionId = :tx AND paidAmountPence = :paid'+
    (verified.transactionIds?' AND balanceTransactionId = :balanceTx':'')+
    (booking.refundStatus==='PARTIALLY_REFUNDED'?' AND refundedAmountPence = :oldAmount':''),
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':next':nextStatus,':previous':booking.refundStatus,
    ':cancelled':'CANCELLED',':due':booking.refundDuePence,':amount':verified.amountPence,':outstanding':verified.outstandingPence,
    ':at':at,':tx':verified.transactionId,':paid':booking.paidAmountPence,
    ...(verified.transactionIds?{':balanceTx':verified.transactionIds[1]}:{}),
    ...(booking.refundStatus==='PARTIALLY_REFUNDED'?{':oldAmount':previous}:{})}}},
  {Put:{TableName:table,Item:claim,ConditionExpression:'attribute_not_exists(PK)'}},
  {Put:{TableName:table,Item:audit,ConditionExpression:'attribute_not_exists(PK)'}}
 ]}));
 return {status:nextStatus,bookingId,amountPence:verified.amountPence,
  outstandingPence:verified.outstandingPence,auditId};
}
