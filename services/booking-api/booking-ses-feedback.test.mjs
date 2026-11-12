import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileAuthenticatedSesFeedback,parseSesFeedback} from './booking-ses-feedback.mjs';

const bookingId='12345678-1234-1234-1234-123456789abc';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const record={PK:'BOOKING#'+bookingId,SK:'EMAIL#confirmed#confirmed_v1',
 bookingId,type:'confirmed',templateId:'confirmed_v1',
 to:'verified@example.com',sesMessageId:'00000123456789012345',
 state:'ACCEPTED_BY_SES_NOT_DELIVERED'};
const event=type=>({eventType:type,mail:{messageId:record.sesMessageId,
 destination:[record.to],tags:{bookingId:[bookingId],emailType:['confirmed'],
 templateId:['confirmed_v1']}}});
const notification=type=>({Type:'Notification',Message:JSON.stringify(event(type)),
 Signature:'test-signature'});
function makeStore(initial=record){
 let current={...initial},writes=0,reads=0;
 const db={async send(command){
  if(command.constructor.name==='GetCommand'){reads++;return {Item:{...current}};}
  if(command.constructor.name==='UpdateCommand'){
   writes++;
   const values=command.input.ExpressionAttributeValues;
   if(current.state!==values[':previous']){const e=new Error('raced');e.name='ConditionalCheckFailedException';throw e;}
   current.state=values[':next'];return {};
  }
  throw Error('Unexpected command');
 }};
 return {db,get current(){return current;},get writes(){return writes;},
  get reads(){return reads;}};
}
const reconcile=(store,type,overrides={})=>reconcileAuthenticatedSesFeedback({
 db:store.db,table,notification:notification(type),
 verifyEnvelope:async()=>true,now:()=>new Date('2026-11-03T21:00:00.000Z').toISOString(),
 ...overrides});
test('LB-09 delivered receipt updates only matching accepted outbox and duplicate is inert',async()=>{
 const s=makeStore();
 assert.equal((await reconcile(s,'Delivery')).state,'DELIVERED');
 assert.equal((await reconcile(s,'Delivery')).status,'IGNORED_ALREADY_RECONCILED');
 assert.equal(s.writes,1);
});
test('LB-09 bounce and complaint win over delivered; terminal state cannot be erased',async()=>{
 for(const type of ['Bounce','Complaint']){
  const s=makeStore();
  await reconcile(s,'Delivery');
  assert.equal((await reconcile(s,type)).state,type==='Bounce'?'BOUNCED':'COMPLAINED');
  assert.equal((await reconcile(s,'Delivery')).status,'IGNORED_ALREADY_RECONCILED');
  assert.equal(s.writes,2);
 }
});
test('LB-09 fails before DynamoDB on unsigned SNS envelopes, arbitrary flags and untrusted JSON',async()=>{
 const s=makeStore();
 await assert.rejects(reconcile(s,'Delivery',{verifyEnvelope:async()=>false}),/Unverified/);
 await assert.rejects(reconcile(s,'Delivery',{verifyEnvelope:undefined}),/unavailable/);
 await assert.rejects(reconcile(s,'Delivery',{notification:{...notification('Delivery'),verified:true},
 verifyEnvelope:async()=>false}),/Unverified/);
 assert.equal(s.reads,0);
 assert.equal(s.writes,0);
});
test('LB-09 refuses forged identifiers or destination and cannot change booking state',async()=>{
 for(const change of [
  {mail:{...event('Delivery').mail,messageId:'different-message-id'}},
  {mail:{...event('Delivery').mail,destination:['outside@example.org']}},
  {mail:{...event('Delivery').mail,tags:{...event('Delivery').mail.tags,templateId:['other_v1']}}}
 ]){
  const s=makeStore();
  await assert.rejects(reconcile(s,'Delivery',{notification:{Type:'Notification',
   Message:JSON.stringify({...event('Delivery'),...change})}}));
  assert.equal(s.writes,0);
 }
 assert.throws(()=>parseSesFeedback({eventType:'Send',mail:event('Delivery').mail}));
});
test('LB-09 refused feedback when provider acknowledgement never recorded',async()=>{
 const s=makeStore({...record,state:'CLAIMED'});
 await assert.rejects(reconcile(s,'Delivery'),/provider acceptance/);
 assert.equal(s.writes,0);
});
test('signed provider feedback recovers an uncertain send without resending',async()=>{
 const uncertain={...record,state:'RECONCILIATION_REQUIRED',sender:'info@lesbuttes.com',claimedAt:'2026-11-03T20:59:00.000Z'};
 delete uncertain.sesMessageId;
 const payload=event('Delivery');payload.mail.source=uncertain.sender;payload.mail.timestamp='2026-11-03T20:59:01.000Z';
 const s=makeStore(uncertain);
 const result=await reconcile(s,'Delivery',{notification:{Type:'Notification',Message:JSON.stringify(payload)}});
 assert.equal(result.status,'RECOVERED_FROM_VERIFIED_FEEDBACK');assert.equal(s.writes,1);
 payload.mail.source='wrong@example.invalid';
 await assert.rejects(reconcile(makeStore(uncertain),'Delivery',{notification:{Type:'Notification',Message:JSON.stringify(payload)}}),/cannot be correlated/);
});

test('signed SES feedback can reconcile exact production outbox without booking mutations',async()=>{
 const store=makeStore();
 const productionTable='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
 const outcome=await reconcileAuthenticatedSesFeedback({
  db:store.db,table:productionTable,notification:notification('Delivery'),
  verifyEnvelope:async()=>true,now:()=>new Date('2026-11-12T20:30:00Z').toISOString()
 });
 assert.equal(outcome.state,'DELIVERED');
 assert.equal(store.writes,1);
 for(const badTable of ['les-buttes-booking-production-BookingTable-X',
  'les-buttes-booking-prod-BookingTable-XYZ','arbitrary-table']){
  await assert.rejects(reconcileAuthenticatedSesFeedback({
   db:store.db,table:badTable,notification:notification('Delivery'),
   verifyEnvelope:async()=>true
  }),/unavailable/);
 }
});
