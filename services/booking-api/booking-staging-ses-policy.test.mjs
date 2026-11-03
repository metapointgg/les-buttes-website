import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingSesPolicy,validateStagingSesMessage} from './booking-staging-ses-policy.mjs';
const bookingId='12345678-1234-1234-1234-123456789abc';
const env={
 BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 BOOKING_SES_REGION:'us-east-1',
 BOOKING_EMAILS_ENABLED:'true',BOOKING_SES_SANDBOX_ACK:'true',
 BOOKING_SES_FROM:'bookings@lesbuttes.com',
 BOOKING_SES_TEST_RECIPIENTS:'verified@example.com,second@example.org'
};
const message={env,to:'verified@example.com',type:'confirmed',subject:'Your test booking',
 body:'Test email for the booking lifecycle.',templateId:'booking_confirmed_v1',bookingId};
test('LB-09 staging SES defaults to disabled, independently of booking Lambda AWS region',()=>{
 assert.equal(stagingSesPolicy({}).enabled,false);
 const safe=stagingSesPolicy(env);
 assert.equal(safe.enabled,true,safe.failures.join('; '));
 assert.equal(safe.region,'us-east-1');
 assert.equal(validateStagingSesMessage(message).allowed,true);
});
test('LB-09 refuses misconfigured region, non-staging, disabled switch and missing sandbox acknowledgement',()=>{
 for(const [key,value] of Object.entries({
  BOOKING_ENVIRONMENT:'production',BOOKING_SES_REGION:'eu-west-2',
  BOOKING_EMAILS_ENABLED:'false',BOOKING_SES_SANDBOX_ACK:'false'
 })){
  assert.equal(stagingSesPolicy({...env,[key]:value}).enabled,false,key);
 }
 assert.equal(stagingSesPolicy({...env,BOOKING_SES_REGION:undefined}).enabled,false);
});
test('LB-09 refuses unlisted guest recipients, spoofed sender, malformed allowlist and duplicate addresses',()=>{
 for(const to of ['guest@example.com','verified@example.com.evil.org',null]){
  assert.equal(validateStagingSesMessage({...message,to}).allowed,false,String(to));
 }
 for(const from of ['bookings@lesbuttes.com.evil.org','bookings@lesbuttes.co.uk','admin@other.com']){
  assert.equal(stagingSesPolicy({...env,BOOKING_SES_FROM:from}).enabled,false,from);
 }
 for(const list of ['', 'verified@example.com,verified@example.com','not-an-email']){
  assert.equal(stagingSesPolicy({...env,BOOKING_SES_TEST_RECIPIENTS:list}).enabled,false,list);
 }
});
test('LB-09 limits event types, body, template id, reference and header injection',()=>{
 for(const change of [
  {type:'payment_verification_pending'},
  {subject:'Test\r\nBcc: attacker@example.com'},
  {body:'short'},
  {templateId:'../../invoice'},
  {bookingId:'booking#1'}
 ]){
  assert.equal(validateStagingSesMessage({...message,...change}).allowed,false,
   JSON.stringify(change));
 }
});
