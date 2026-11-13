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
 if(transaction.simple_status!=='REFUNDED'||transaction.status!=='REFUNDED'||
  pence(transaction.refunded_amount)!==booking.refundDuePence)
  throw Error('SumUp refund not verified');
 const events=transaction.transaction_events??transaction.events;
 if(!Array.isArray(events))throw Error('Authoritative refund events missing');
 const refunds=events.filter(event=>(event?.event_type??event?.type)==='REFUND');
 if(!refunds.length||refunds.some(x=>!['REFUNDED','SUCCESSFUL'].includes(x.status))||
  refunds.reduce((total,x)=>total+pence(x.amount),0)!==booking.refundDuePence)
  throw Error('Verified refund events do not match amount');
 // SumUp payout deductions and retained fees are separate from customer refund.
 return {amountPence:booking.refundDuePence,currency:'GBP',transactionId:booking.paymentTransactionId,
  refundEvents:refunds.length};
}

export async function reconcileVerifiedProductionRefund({db,table,bookingId,identity,
 fetchTransaction,merchantCode,now=()=>new Date().toISOString()}={}){
 if(!db?.send||!TABLE.test(table??'')||!ID.test(bookingId??'')||
  identity?.role!=='owner'||!identity.subject||typeof fetchTransaction!=='function')
  throw Error('Owner refund reconciliation unavailable');
 const key={PK:'BOOKING#'+bookingId,SK:'META'};
 const booking=(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 if(!booking||booking.id!==bookingId)throw Error('Booking not found');
 if(booking.refundStatus==='REFUNDED'){
  // Idempotent reads still need provider evidence, never trust local status alone.
  const provider=await fetchTransaction(booking.paymentTransactionId);
  const verified=verifyProductionRefundEvidence({
   booking:{...booking,refundStatus:'ASSESSED'},transaction:provider,merchantCode});
  if(booking.refundedAmountPence!==verified.amountPence)
   throw Error('Recorded refund amount mismatch');
  return {status:'ALREADY_REFUNDED',bookingId,amountPence:verified.amountPence};
 }
 if(booking.refundStatus!=='ASSESSED')throw Error('Refund has not been assessed');
 const provider=await fetchTransaction(booking.paymentTransactionId);
 const verified=verifyProductionRefundEvidence({booking,transaction:provider,merchantCode});
 const at=now(),auditId=randomUUID();
 if(!/^\d{4}-\d{2}-\d{2}T/.test(at))throw Error('Invalid reconciliation time');
 const claim={PK:'BOOKING#'+bookingId,SK:'REFUND#PROVIDER_VERIFIED',
  bookingId,transactionId:verified.transactionId,amountPence:verified.amountPence,
  currency:'GBP',state:'REFUNDED',verifiedAt:at,refundEvents:verified.refundEvents};
 const audit={PK:'BOOKING#'+bookingId,SK:'AUDIT#'+at+'#'+auditId,
  id:auditId,bookingId,action:'refund_verified',actor:identity.subject,
  provider:'sumup',amountPence:verified.amountPence,transactionId:verified.transactionId,recordedAt:at};
 await db.send(new TransactWriteCommand({TransactItems:[
  {ConditionCheck:{TableName:table,Key:{PK:'PAYMENT_TRANSACTION#'+verified.transactionId,SK:'CONFIRMATION'},
   ConditionExpression:'bookingId = :booking AND amountPence = :amount AND currency = :currency',
   ExpressionAttributeValues:{':booking':bookingId,':amount':booking.paidAmountPence,':currency':'GBP'}}},
  {Update:{TableName:table,Key:key,
   UpdateExpression:'SET refundStatus = :refunded,refundedAmountPence = :amount,refundedAt = :at',
   ConditionExpression:'#status = :cancelled AND reservationStatus = :cancelled AND refundStatus = :assessed AND refundDuePence = :amount AND paymentTransactionId = :tx AND paidAmountPence = :paid',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':refunded':'REFUNDED',':cancelled':'CANCELLED',':assessed':'ASSESSED',
    ':amount':verified.amountPence,':at':at,':tx':verified.transactionId,':paid':booking.paidAmountPence}}},
  {Put:{TableName:table,Item:claim,ConditionExpression:'attribute_not_exists(PK)'}},
  {Put:{TableName:table,Item:audit,ConditionExpression:'attribute_not_exists(PK)'}}
 ]}));
 return {status:'REFUNDED',bookingId,amountPence:verified.amountPence,auditId};
}
