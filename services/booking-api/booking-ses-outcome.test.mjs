import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyVerifiedSesOutcome,applyVerifiedSesOutcome} from './booking-ses-outcome.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const outbox={PK:'BOOKING#12345678-1234-1234-1234-123456789abc',
 SK:'EMAIL#confirmed#confirmed_v1',sesMessageId:'ses-test-message-id',
 to:'verified@example.com',state:'ACCEPTED_BY_SES_NOT_DELIVERED'};
const notification=(eventType,details={})=>({
 eventType,mail:{messageId:'ses-test-message-id',destination:['verified@example.com']},
 ...(eventType==='Bounce'?{bounce:{bounceType:'Permanent'}}:{}),
 ...(eventType==='Complaint'?{complaint:{complainedRecipients:[{emailAddress:'verified@example.com'}]}}:{}),
 ...details});
const run=async ({event=notification('Delivery'),record=outbox,authenticatedSns=true,
 failWrite=false}={})=>{
 const calls=[];
 const db={async send(command){
  calls.push(command.input);
  if(failWrite){const error=new Error('Changed');error.name='ConditionalCheckFailedException';throw error;}
  return {};
 }};
 const result=await applyVerifiedSesOutcome({db,table,notification:event,
  outbox:record,authenticatedSns,now:()=> '2026-11-03T21:30:00.000Z'});
 return {result,calls};
};
test('LB-09 correlates delivery to exact SES ID, single recipient and accepted outbox',async()=>{
 const {result,calls}=await run();
 assert.deepEqual(result,{action:'UPDATED',status:'DELIVERED'});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].Key,{PK:outbox.PK,SK:outbox.SK});
 assert.equal(calls[0].ExpressionAttributeValues[':messageId'],outbox.sesMessageId);
 assert.equal(calls[0].ExpressionAttributeValues[':previous'],outbox.state);
});
test('LB-09 tracks bounce/complaint and late adverse outcomes without losing prior delivery',async()=>{
 for(const kind of ['Bounce','Complaint']){
  assert.deepEqual((await run({event:notification(kind)})).result,
   {action:'UPDATED',status:kind==='Bounce'?'BOUNCED':'COMPLAINED'});
 }
 assert.deepEqual((await run({event:notification('Bounce'),
  record:{...outbox,state:'DELIVERED'}})).result,{action:'UPDATED',status:'BOUNCED'});
 const duplicate=await run({event:notification('Delivery'),record:{...outbox,state:'DELIVERED'}});
 assert.deepEqual(duplicate.result,{action:'DUPLICATE',status:'DELIVERED'});
 assert.equal(duplicate.calls.length,0);
 const illegal=await run({record:{...outbox,state:'BOUNCED'}});
 assert.equal(illegal.result.action,'RECONCILE');
 assert.equal(illegal.calls.length,0);
});
test('LB-09 rejects untrusted notification and mismatched message ID or recipient without a write',async()=>{
 await assert.rejects(run({authenticatedSns:false}),/Verified SNS/);
 for(const event of [
  notification('Delivery',{mail:{messageId:'different',destination:['verified@example.com']}}),
  notification('Delivery',{mail:{messageId:'ses-test-message-id',destination:['other@example.com']}}),
  notification('Delivery',{mail:{messageId:'ses-test-message-id',destination:['verified@example.com','other@example.com']}}),
  notification('Complaint',{complaint:{complainedRecipients:[{emailAddress:'other@example.com'}]}}),
  notification('Bounce',{bounce:{bounceType:'Invalid'}}),
  notification('Open')
 ])await assert.rejects(run({event}),/SES/);
});
test('LB-09 refuses production or missing identity and reconciles stale conditional updates',async()=>{
 const stale=await run({failWrite:true});
 assert.equal(stale.result.action,'RECONCILE');
 assert.equal(stale.calls.length,1);
 await assert.rejects(applyVerifiedSesOutcome({db:{send:async()=>{}},
  table:'les-buttes-booking-production-BookingTable-abc',
  notification:notification('Delivery'),outbox,authenticatedSns:true}),/Verified SNS/);
 assert.throws(()=>classifyVerifiedSesOutcome({notification:notification('Delivery'),
  outbox:{...outbox,SK:'EMAIL#../../other'}}));
});
