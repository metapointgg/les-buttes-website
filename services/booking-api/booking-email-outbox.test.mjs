import test from 'node:test';
import assert from 'node:assert/strict';
import {sendBookingEmailOnce,emailOutboxKey} from './booking-email-outbox.mjs';
const env={BOOKING_ENVIRONMENT:'staging',BOOKING_SES_REGION:'us-east-1',
 BOOKING_EMAILS_ENABLED:'true',BOOKING_SES_SANDBOX_ACK:'true',
 BOOKING_SES_FROM:'bookings@lesbuttes.com',BOOKING_SES_TEST_RECIPIENTS:'verified@example.com'};
const message={to:'verified@example.com',type:'confirmed',subject:'Test booking confirmation',
 body:'Staging test booking confirmation message.',templateId:'confirmed_v1',
 bookingId:'12345678-1234-1234-1234-123456789abc'};
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const store=({failSend=false,failAcknowledge=false}={})=>{
 let item=null,sends=0,reads=0;
 const db={async send(command){
  const operation=command.constructor.name,params=command.input;
  if(operation==='PutCommand'){
   if(item){const e=new Error('duplicate');e.name='ConditionalCheckFailedException';throw e;}
   item={...params.Item};return {};
  }
  if(operation==='GetCommand'){reads++;return {Item:item};}
  if(operation==='UpdateCommand'){
   if(failAcknowledge)throw Error('DynamoDB status write unavailable');
   if(item?.state!=='CLAIMED')throw Error('Stale state');
   item.state=params.ExpressionAttributeValues[':accepted']??params.ExpressionAttributeValues[':unknown'];
   item.sesMessageId=params.ExpressionAttributeValues[':messageId'];
   return {};
  }
  throw Error('Unexpected DB command '+operation);
 }};
 const transport={async send(){
  sends++;
  if(failSend)throw Error('ambiguous network timeout');
  return {status:'ACCEPTED_BY_SES_NOT_DELIVERED',messageId:'ses-123'};
 }};
 return {db,transport,get item(){return item;},get sends(){return sends;},get reads(){return reads;}};
};
const send=(x,overrides={})=>sendBookingEmailOnce({db:x.db,transport:x.transport,
 table,env,message,now:()=>new Date('2026-11-03T20:00:00.000Z').toISOString(),...overrides});
test('LB-09 claims outbox before one send, and duplicate returns without sending',async()=>{
 const x=store();
 const first=await send(x);
 assert.equal(first.status,'ACCEPTED_BY_SES_NOT_DELIVERED');
 assert.equal(x.item.state,'ACCEPTED_BY_SES_NOT_DELIVERED');
 assert.equal(x.sends,1);
 const duplicate=await send(x);
 assert.equal(duplicate.status,'ALREADY_CLAIMED');
 assert.equal(duplicate.state,'ACCEPTED_BY_SES_NOT_DELIVERED');
 assert.equal(x.sends,1);
 assert.equal(x.reads,1);
});
test('LB-09 holds permanent claim on ambiguous send failure and never retries',async()=>{
 const x=store({failSend:true});
 await assert.rejects(send(x),/manual reconciliation/);
 assert.equal(x.item.state,'RECONCILIATION_REQUIRED');
 assert.equal((await send(x)).status,'ALREADY_CLAIMED');
 assert.equal(x.sends,1);
});
test('LB-09 does not resend if SES accepted but final DynamoDB acknowledgement failed',async()=>{
 const x=store({failAcknowledge:true});
 await assert.rejects(send(x),/manual reconciliation/);
 assert.equal(x.item.state,'CLAIMED');
 assert.equal((await send(x)).status,'ALREADY_CLAIMED');
 assert.equal(x.sends,1);
});
test('LB-09 fails before claim or send when recipient, sender, flag or table is unsafe',async()=>{
 const x=store();
 for(const changes of [
  {env:{...env,BOOKING_EMAILS_ENABLED:'false'}},
  {message:{...message,to:'guest@outside.example'}},
  {table:'les-buttes-booking-production-BookingTable-bad'}
 ])await assert.rejects(send(x,changes));
 assert.equal(x.item,null);
 assert.equal(x.sends,0);
});
test('LB-09 outbox uses stable per-booking event and template identity',()=>{
 assert.deepEqual(emailOutboxKey(message),{PK:'BOOKING#'+message.bookingId,
  SK:'EMAIL#confirmed#confirmed_v1'});
 assert.throws(()=>emailOutboxKey({...message,templateId:'../bad'}));
});
