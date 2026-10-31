// Host-only reusable writer. No HTTP route, no payment confirmation.
// Caller supplies a strongly consistent booking read and an authorised identity.
import {randomUUID} from 'node:crypto';
import {TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {prepareOwnerTransition} from './booking-admin-transaction-policy.mjs';

export async function executeOwnerTransition({db,table,readBooking,identity,bookingId,action,reason,
  nowEpoch=Math.floor(Date.now()/1000),approval}={}){
 if(!db?.send||typeof readBooking!=='function'||typeof table!=='string'||!table)
   throw Error('Writer is not configured');
 if(!identity||identity.role!=='owner')throw Error('Forbidden');
 if(!/^[0-9a-f-]{36}$/i.test(bookingId??''))throw Error('Invalid booking reference');
 if(!['approve','decline','cancel'].includes(action))throw Error('Action not enabled for transactional writer');
 const booking=await readBooking(bookingId);
 const decision=prepareOwnerTransition({identity,action,booking,reason,nowEpoch});
 if(!decision.allowed)throw Error(decision.reason);
 if(booking.id!==bookingId)throw Error('Booking identity mismatch');
 if(action==='approve'){
   if(!approval||!Number.isSafeInteger(approval.amountPence)||approval.amountPence<=0)
     throw Error('Approval requires a positive amount in pence');
   if(typeof approval.paymentUrl!=='string')throw Error('Approval requires a payment URL');
   let url;
   try{url=new URL(approval.paymentUrl);}catch{throw Error('Invalid payment URL');}
   const allowedHost=process.env.BOOKING_ENVIRONMENT==='staging'?'test.invalid':'pay.sumup.com';
   if(url.protocol!=='https:'||url.hostname!==allowedHost||url.username||url.password)
     throw Error('Payment URL must be an approved HTTPS SumUp host');
   const quotedPence=Math.round(Number(booking.quote?.totalGBP)*100);
   if(!Number.isSafeInteger(quotedPence)||quotedPence<=0)throw Error('Booking quote missing');
   if(quotedPence!==approval.amountPence&&
      (typeof approval.priceChangeReason!=='string'||approval.priceChangeReason.trim().length<5))
     throw Error('Changed approval price requires an audit reason');
 }
 const names={'#status':'status'};
 const values={':expected':decision.from,':next':decision.to,':now':nowEpoch,
   ':updatedAt':new Date(nowEpoch*1000).toISOString(),':id':bookingId};
 let update='SET #status = :next, updatedAt = :updatedAt';
 if(action==='approve'){
   update+=', holdExpiresAt = :nextExpiry, approvedAmountGBP = :amount, paymentUrl = :paymentUrl';
   values[':nextExpiry']=nowEpoch+48*3600;
   values[':amount']=approval.amountPence/100;
   values[':paymentUrl']=approval.paymentUrl;
   if(approval.priceChangeReason?.trim()){
     update+=', priceChangeReason = :priceReason';
     values[':priceReason']=approval.priceChangeReason.trim();
   }
 }
 if(action==='cancel'){
   update+=', cancelReason = :reason, cancelledAt = :updatedAt';
   values[':reason']=reason.trim();
 }
 if(action==='cancel'){
   update+=', expiresAt = :recordExpiry';
   values[':recordExpiry']=nowEpoch+90*86400;
 }
 if(booking.source==='direct'){
   update+=', reservationStatus = :reservationStatus';
   values[':reservationStatus']=action==='approve'?'AWAITING_PAYMENT':decision.to;
 }
 let condition='#status = :expected AND id = :id';
 if(action==='approve'||action==='decline'){
   condition+=' AND holdExpiresAt = :observedExpiry AND holdExpiresAt > :now';
   values[':observedExpiry']=booking.holdExpiresAt;
 }
 const items=[{Update:{TableName:table,Key:decision.metadataKey,
   UpdateExpression:update,ConditionExpression:condition,
   ExpressionAttributeNames:names,ExpressionAttributeValues:values}}];
 for(const key of decision.slots){
   if(action==='approve'){
     items.push({Update:{TableName:table,Key:key,
       UpdateExpression:'SET expiresAt = :nextExpiry',
       ConditionExpression:'id = :id AND expiresAt > :now',
       ExpressionAttributeValues:{':id':bookingId,':now':nowEpoch,':nextExpiry':nowEpoch+48*3600}}});
   }else{
     items.push({Delete:{TableName:table,Key:key,
       ConditionExpression:'id = :id',
       ExpressionAttributeValues:{':id':bookingId}}});
   }
 }
 await db.send(new TransactWriteCommand({TransactItems:items,ClientRequestToken:randomUUID()}));
 return {id:bookingId,from:decision.from,to:decision.to,affectedNights:decision.slots.length};
}
