import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOwnerAction} from './booking-admin-action-policy.mjs';
const booking=status=>({status,holdExpiresAt:Math.floor(Date.now()/1000)+3600});
test('owner may request only permitted lifecycle transitions',()=>{
  for(const [action,from,to] of [
    ['approve','REQUESTED','APPROVED_AWAITING_PAYMENT'],
    ['decline','REQUESTED','DECLINED'],
    ['cancel','CONFIRMED','CANCELLED']
  ])assert.deepEqual(checkOwnerAction({identity:{role:'owner'},action,booking:booking(from),reason:'Owner-approved cancellation after reconciliation'}),{allowed:true,from,to});
});
test('viewer and admin roles cannot change booking state',()=>{
  for(const role of ['viewer','admin',undefined])
    assert.equal(checkOwnerAction({identity:role?{role}:null,action:'approve',booking:booking('REQUESTED')}).allowed,false);
});
test('wrong state, expired hold and unsupported confirmation are denied',()=>{
  assert.equal(checkOwnerAction({identity:{role:'owner'},action:'approve',booking:booking('CONFIRMED')}).allowed,false);
  assert.equal(checkOwnerAction({identity:{role:'owner'},action:'approve',booking:{status:'REQUESTED',holdExpiresAt:1}}).allowed,false);
  for(const holdExpiresAt of [undefined,null,'not-a-number',NaN]){
    assert.equal(checkOwnerAction({identity:{role:'owner'},action:'approve',booking:{status:'REQUESTED',holdExpiresAt}}).allowed,false);
    assert.equal(checkOwnerAction({identity:{role:'owner'},action:'decline',booking:{status:'REQUESTED',holdExpiresAt}}).allowed,false);
  }
  assert.equal(checkOwnerAction({identity:{role:'owner'},action:'confirm',booking:booking('APPROVED_AWAITING_PAYMENT')}).allowed,false);
  assert.equal(checkOwnerAction({identity:{role:'owner'},action:'__proto__',booking:booking('REQUESTED')}).allowed,false);
});

test('cancellation requires a meaningful auditable reason',()=>{
  const request={identity:{role:'owner'},action:'cancel',booking:booking('CONFIRMED')};
  for(const reason of [undefined,'','  ','no', 'x'.repeat(1001)])
    assert.equal(checkOwnerAction({...request,reason}).allowed,false);
  assert.equal(checkOwnerAction({...request,reason:'Guest requested cancellation; refund reviewed'}).allowed,true);
});
