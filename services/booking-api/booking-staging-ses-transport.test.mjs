import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingSesTransport} from './booking-staging-ses-transport.mjs';
const env={
 BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 BOOKING_SES_REGION:'us-east-1',BOOKING_EMAILS_ENABLED:'true',
 BOOKING_SES_SANDBOX_ACK:'true',BOOKING_SES_FROM:'bookings@lesbuttes.com',
 BOOKING_SES_TEST_RECIPIENTS:'verified@example.com'
};
const message={to:'verified@example.com',type:'confirmed',subject:'Test booking confirmation',
 body:'This is an explicitly approved staging message.',templateId:'confirmed_v1',
 bookingId:'12345678-1234-1234-1234-123456789abc'};
const setup=(config=env,response={MessageId:'ses-test-receipt-1'})=>{
 const calls=[],regions=[];let destroyed=0;
 const transport=createStagingSesTransport({env:config,
  clientFactory:region=>{regions.push(region);return {
   send:async c=>{calls.push(c);return response;},destroy(){destroyed++;}};},
  commandFactory:x=>x});
 return {transport,calls,regions,get destroyed(){return destroyed;}};
};
test('LB-09 uses explicit us-east-1 SES client and only the expected text envelope',async()=>{
 const x=setup();
 const result=await x.transport.send(message);
 assert.equal(result.status,'ACCEPTED_BY_SES_NOT_DELIVERED');
 assert.deepEqual(x.regions,['us-east-1']);
 assert.equal(x.calls.length,1);
 assert.deepEqual(x.calls[0].Destination,{ToAddresses:['verified@example.com']});
 assert.equal(x.calls[0].Source,'bookings@lesbuttes.com');
 assert.deepEqual(x.calls[0].Message.Body,{Text:{Data:message.body,Charset:'UTF-8'}});
 assert.equal(x.destroyed,1);
});
test('LB-09 has no client construction or email send when policy fails',async()=>{
 for(const config of [{}, {...env,BOOKING_EMAILS_ENABLED:'false'},
  {...env,BOOKING_SES_REGION:'eu-west-2'}]){
  const x=setup(config);
  await assert.rejects(x.transport.send(message),/not authorised/);
  assert.deepEqual(x.regions,[]);
  assert.deepEqual(x.calls,[]);
 }
 const x=setup();
 await assert.rejects(x.transport.send({...message,to:'guest@unverified.example'}),/not authorised/);
 assert.deepEqual(x.calls,[]);
});
test('LB-09 distinguishes provider acceptance from guest delivery and fails closed on missing receipt',async()=>{
 const x=setup(env,{});
 await assert.rejects(x.transport.send(message),/manual reconciliation required/);
 assert.equal(x.calls.length,1);
 assert.equal(x.destroyed,1);
});
test('LB-09 closes SES client on send failure',async()=>{
 let closed=0;
 const transport=createStagingSesTransport({env,
  clientFactory:()=>({send:async()=>{throw Error('SES denied');},destroy:()=>{closed++;}}),
  commandFactory:x=>x});
 await assert.rejects(transport.send(message),/SES denied/);
 assert.equal(closed,1);
});
