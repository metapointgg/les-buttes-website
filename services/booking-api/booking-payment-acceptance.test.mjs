import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentAcceptance} from './booking-payment-acceptance.mjs';
const schedule={totalPence:80501,dueNowPence:40251,balancePence:40250,dueDate:'2027-04-24'};
const policyVersion='2026-11-14T10:00:00.000Z#approval';
test('guest can accept exact two-instalment terms and fixed policy version',()=>{
 assert.deepEqual(validatePaymentAcceptance({schedule,policyVersion,
  acceptance:{...schedule,policyVersion}}),{legacyFullPayment:false});
});
test('booking cannot silently change guest payment terms or round away a penny',()=>{
 for(const accepted of [
  undefined,
  {...schedule,policyVersion:'older-version'},
  {...schedule,policyVersion,dueNowPence:40250},
  {...schedule,policyVersion,balancePence:0},
  {...schedule,policyVersion,dueDate:'2027-04-25'},
  {...schedule,policyVersion,totalPence:80500},
  {...schedule,policyVersion,extra:'ignored'}
 ]){
  if(accepted?.extra){assert.equal(validatePaymentAcceptance({acceptance:accepted,schedule,policyVersion}).legacyFullPayment,false);continue;}
  assert.throws(()=>validatePaymentAcceptance({acceptance:accepted,schedule,policyVersion}),/terms changed/i);
 }
});
test('legacy clients work with the historical unpublished full-payment policy only',()=>{
 const full={totalPence:80500,dueNowPence:80500,balancePence:0,dueDate:null};
 assert.deepEqual(validatePaymentAcceptance({schedule:full,policyVersion:null}),{legacyFullPayment:true});
 assert.throws(()=>validatePaymentAcceptance({schedule:full,policyVersion}),/terms changed/i);
 assert.throws(()=>validatePaymentAcceptance({schedule,policyVersion:null}),/terms changed/i);
});
