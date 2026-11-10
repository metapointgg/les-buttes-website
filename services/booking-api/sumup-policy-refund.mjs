// Staging-only policy-derived SumUp refund orchestration.
// An immutable claim is written before the provider POST. Any uncertain outcome
// is reconciled by provider reads and is never blindly re-submitted.
import {randomUUID} from 'node:crypto';
import {GetCommand,PutCommand,TransactWriteCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export async function executePolicyRefund({db,table,bookingId,readProvider,requestProviderRefund,
 now=()=>new Date().toISOString(),enabled=false}={}){
 if(!enabled||!db?.send||!TABLE.test(table??'')||!UUID.test(bookingId??'')||
   typeof readProvider!=='function'||typeof requestProviderRefund!=='function')
  throw Error('Staging policy refunds disabled');
 const get=async key=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const booking=await get({PK:'BOOKING#'+bookingId,SK:'META'});
 const checkout=await get({PK:'BOOKING#'+bookingId,SK:'PAYMENT#CHECKOUT'});
 if(booking?.id!==bookingId||booking.synthetic!==true||booking.guestEmail!=='test@example.invalid'||
   booking.source!=='direct'||booking.status!=='CANCELLED'||
   !['ASSESSED','REFUNDED'].includes(booking.refundStatus)||
   (booking.refundStatus==='REFUNDED'&&booking.refundedAmountPence!==booking.refundDuePence)||
   !Number.isSafeInteger(booking.refundDuePence)||booking.refundDuePence<1||
   !Number.isSafeInteger(booking.paidAmountPence)||booking.paidAmountPence<booking.refundDuePence||
   !UUID.test(booking.paymentTransactionId??'')||typeof booking.refundPolicyVersion!=='string'||
   checkout?.amountPence!==booking.paidAmountPence||checkout.currency!=='GBP')
  throw Error('Assessed cancelled synthetic booking required');
 const claimKey={PK:'BOOKING#'+bookingId,SK:'REFUND#POLICY'};
 let claim=await get(claimKey);
 const expected={bookingId,transactionId:booking.paymentTransactionId,
  amountPence:booking.refundDuePence,policyVersion:booking.refundPolicyVersion,
  policyId:booking.refundPolicyId,refundPercent:booking.refundPercent};
 if(claim&&Object.entries(expected).some(([key,value])=>claim[key]!==value))
  throw Error('Refund claim mismatch');
 if(!claim&&booking.refundStatus!=='ASSESSED')
  throw Error('Verified refund claim required');
 const providerBefore=await readProvider(booking.paymentTransactionId);
 const verifyProvider=provider=>{
  if(provider?.transactionId!==booking.paymentTransactionId||provider.currency!=='GBP'||
    provider.paidPence!==booking.paidAmountPence||!Number.isSafeInteger(provider.refundedPence)||
    provider.refundedPence<0||provider.refundedPence>provider.paidPence||typeof provider.refundPending!=='boolean')
   throw Error('Provider refund evidence mismatch');
  return provider;
 };
 verifyProvider(providerBefore);
 if(!claim){
  if(providerBefore.refundedPence!==0||providerBefore.refundPending)
   throw Error('Payment already has an unclaimed provider refund');
  const stamp=now();
  claim={...claimKey,...expected,state:'REQUESTED',createdAt:stamp};
  await db.send(new PutCommand({TableName:table,Item:claim,ConditionExpression:'attribute_not_exists(PK)'}));
  try{
   await requestProviderRefund({transactionId:booking.paymentTransactionId,
    amountPence:booking.refundDuePence,full:booking.refundDuePence===booking.paidAmountPence});
  }catch(error){
   await db.send(new UpdateCommand({TableName:table,Key:claimKey,
    UpdateExpression:'SET #state = :state, reconciliationRequiredAt = :at',
    ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':'RECONCILIATION_REQUIRED',':at':now()}}));
   throw error;
  }
 }
 const providerAfter=verifyProvider(await readProvider(booking.paymentTransactionId));
 if(providerAfter.refundPending||providerAfter.refundedPence!==booking.refundDuePence){
  await db.send(new UpdateCommand({TableName:table,Key:claimKey,
   UpdateExpression:'SET #state = :state, checkedAt = :at, verifiedRefundPence = :amount',
   ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':'RECONCILIATION_REQUIRED',
    ':at':now(),':amount':providerAfter.refundedPence}}));
  return {status:'RECONCILIATION_REQUIRED',bookingId,verifiedRefundPence:providerAfter.refundedPence};
 }
 if(claim.state==='REFUNDED')return {status:'ALREADY_REFUNDED',bookingId,amountPence:booking.refundDuePence};
 const stamp=now(),auditId=randomUUID();
 await db.send(new TransactWriteCommand({TransactItems:[
  {Update:{TableName:table,Key:claimKey,UpdateExpression:'SET #state = :refunded, verifiedAt = :at, verifiedRefundPence = :amount',
   ConditionExpression:'#state <> :refunded',ExpressionAttributeNames:{'#state':'state'},
   ExpressionAttributeValues:{':refunded':'REFUNDED',':at':stamp,':amount':booking.refundDuePence}}},
  {Update:{TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},
   UpdateExpression:'SET refundStatus = :refunded, refundedAt = :at, refundedAmountPence = :amount',
   ConditionExpression:'#status = :cancelled AND refundStatus = :assessed AND refundDuePence = :amount AND paymentTransactionId = :transactionId',
   ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':refunded':'REFUNDED',':cancelled':'CANCELLED',
    ':assessed':'ASSESSED',':at':stamp,':amount':booking.refundDuePence,':transactionId':booking.paymentTransactionId}}},
  {Put:{TableName:table,Item:{PK:'BOOKING#'+bookingId,SK:'AUDIT#'+stamp+'#'+auditId,
   id:auditId,bookingId,action:'refund_verified',provider:'sumup',amountPence:booking.refundDuePence,
   transactionId:booking.paymentTransactionId,policyVersion:booking.refundPolicyVersion,recordedAt:stamp},
   ConditionExpression:'attribute_not_exists(PK)'}}
 ]}));
 return {status:'REFUNDED',bookingId,amountPence:booking.refundDuePence,auditId};
}
