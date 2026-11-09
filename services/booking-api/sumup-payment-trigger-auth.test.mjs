import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyInternalPaymentTrigger} from './sumup-payment-trigger-auth.mjs';
const secret='an-internal-test-secret-longer-than-32-bytes';
const bookingId='11111111-1111-4111-8111-111111111111';
const nowEpoch=1800000000;
const sign=body=>createHmac('sha256',secret).update(body).digest('hex');
const verify=(body,extra={})=>verifyInternalPaymentTrigger({body,signature:sign(body),secret,nowEpoch,...extra});
test('valid recent signed internal trigger authenticates a booking reference',()=>{
 const body=JSON.stringify({bookingId,issuedAt:nowEpoch});
 assert.deepEqual(verify(body),{ok:true,bookingId});
});
test('unsigned and tampered messages are rejected',()=>{
 const body=JSON.stringify({bookingId,issuedAt:nowEpoch});
 assert.equal(verifyInternalPaymentTrigger({body,signature:'a'.repeat(64),secret,nowEpoch}).ok,false);
 assert.equal(verifyInternalPaymentTrigger({body,signature:sign(body),secret:'short',nowEpoch}).ok,false);
 assert.equal(verifyInternalPaymentTrigger({body:body.replace(bookingId,'22222222-2222-4222-8222-222222222222'),
  signature:sign(body),secret,nowEpoch}).ok,false);
});
test('expired or future issued triggers fail closed',()=>{
 assert.equal(verify(JSON.stringify({bookingId,issuedAt:nowEpoch-301})).ok,false);
 assert.equal(verify(JSON.stringify({bookingId,issuedAt:nowEpoch+31})).ok,false);
});
test('payment assertions and extra fields cannot be smuggled through signed triggers',()=>{
 assert.equal(verify(JSON.stringify({bookingId,issuedAt:nowEpoch,status:'PAID'})).ok,false);
 assert.equal(verify(JSON.stringify({bookingId,issuedAt:nowEpoch,amount:1})).ok,false);
});
