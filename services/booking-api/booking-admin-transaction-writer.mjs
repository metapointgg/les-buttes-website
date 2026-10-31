// Host-only reusable writer. No HTTP route, no payment confirmation.
// Caller supplies a strongly consistent booking read and an authorised identity.
import {randomUUID} from 'node:crypto';
import {TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {prepareOwnerTransition} from './booking-admin-transaction-policy.mjs';

export async function executeOwnerTransition({db,table,readBooking,identity,bookingId,action,reason,
  nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||typeof readBooking!=='function'||typeof table!=='string'||!table)
   throw Error('Writer is not configured');
 if(!identity||identity.role!=='owner')throw Error('Forbidden');
 if(!/^[0-9a-f-]{36}$/i.test(bookingId??''))throw Error('Invalid booking reference');
 if(!['decline','cancel'].includes(action))throw Error('Action not enabled for transactional writer');
 const booking=await readBooking(bookingId);
 const decision=prepareOwnerTransition({identity,action,booking,reason,nowEpoch});
 if(!decision.allowed)throw Error(decision.reason);
 if(booking.id!==bookingId)throw Error('Booking identity mismatch');
 const names={'#status':'status'};
 const values={':expected':decision.from,':next':decision.to,':now':nowEpoch,
   ':updatedAt':new Date(nowEpoch*1000).toISOString(),':id':bookingId};
 let update='SET #status = :next, updatedAt = :updatedAt';
 if(action==='cancel'){
   update+=', cancelReason = :reason, cancelledAt = :updatedAt';
   values[':reason']=reason.trim();
 }
 if(booking.source==='direct'){
   update+=', reservationStatus = :reservationStatus';
   values[':reservationStatus']=decision.to;
 }
 let condition='#status = :expected';
 if(action==='decline'){
   condition+=' AND holdExpiresAt > :now';
 }
 const items=[{Update:{TableName:table,Key:decision.metadataKey,
   UpdateExpression:update,ConditionExpression:condition,
   ExpressionAttributeNames:names,ExpressionAttributeValues:values}}];
 for(const key of decision.slots){
   items.push({Delete:{TableName:table,Key:key,
     ConditionExpression:'id = :id',
     ExpressionAttributeValues:{':id':bookingId}}});
 }
 await db.send(new TransactWriteCommand({TransactItems:items,ClientRequestToken:randomUUID()}));
 return {id:bookingId,from:decision.from,to:decision.to,releasedNights:decision.slots.length};
}
