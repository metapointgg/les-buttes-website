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
 // The management writer is for website-created direct requests only.
 // Legacy manual blocks and imported reservations have different lifecycles.
 if(booking.source!=='direct'||!booking.GSI1PK||booking.GSI1PK!=='BOOKING_REQUESTS')
   throw Error('Only authoritative direct booking requests may be managed');
 if(action==='approve'||action==='decline'){
   if(booking.reservationStatus!=='PENDING_REVIEW')
     throw Error('Direct request reservation status mismatch');
 }
 if(action==='cancel'&&booking.reservationStatus!=='CONFIRMED')
   throw Error('Confirmed direct reservation status required');
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
 if(typeof identity.subject!=='string'||identity.subject.trim().length<1)
   throw Error('Owner subject required for audit');
 values[':actor']=identity.subject;
 values[':action']=action;
 let update='SET #status = :next, updatedAt = :updatedAt, lastManagementActor = :actor, lastManagementAction = :action';
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
 let condition='#status = :expected AND id = :id AND #source = :direct AND reservationStatus = :expectedReservation AND #units = :observedUnits AND #start = :observedStart AND #end = :observedEnd';
 names['#units']='units'; names['#start']='start'; names['#end']='end';
 values[':observedUnits']=booking.units;
 values[':observedStart']=booking.start;
 values[':observedEnd']=booking.end;
 if(action==='approve'){
   condition+=' AND quote = :observedQuote';
   values[':observedQuote']=booking.quote;
 }
 names['#source']='source';
 values[':direct']='direct';
 values[':expectedReservation']=action==='cancel'?'CONFIRMED':'PENDING_REVIEW';
 if(action==='approve'||action==='decline'){
   condition+=' AND holdExpiresAt = :observedExpiry AND holdExpiresAt > :now';
   values[':observedExpiry']=booking.holdExpiresAt;
 }
 const transitionId=randomUUID();
 const audit={PK:'BOOKING#'+bookingId,SK:'AUDIT#'+new Date(nowEpoch*1000).toISOString()+'#'+transitionId,
   id:transitionId,bookingId,action,from:decision.from,to:decision.to,
   actor:identity.subject,recordedAt:new Date(nowEpoch*1000).toISOString(),
   ...(action==='cancel'?{reason:reason.trim()}:{}),
   ...(action==='approve'?{approvedAmountGBP:approval.amountPence/100}: {})};
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
       ConditionExpression:action==='decline'?'id = :id AND expiresAt > :now':'id = :id',
       ExpressionAttributeValues:action==='decline'?{':id':bookingId,':now':nowEpoch}:{':id':bookingId}}});
   }
 }
 items.push({Put:{TableName:table,Item:audit,ConditionExpression:'attribute_not_exists(PK)'}});
 await db.send(new TransactWriteCommand({TransactItems:items,ClientRequestToken:transitionId}));
 return {id:bookingId,from:decision.from,to:decision.to,affectedNights:decision.slots.length,auditId:transitionId};
}
