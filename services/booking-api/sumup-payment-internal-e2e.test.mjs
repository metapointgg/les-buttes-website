// LB-08 synthetic end-to-end INTERNAL trigger test; never calls SumUp or AWS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {GetCommand,PutCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {processSignedInternalPaymentTrigger} from './sumup-payment-notification.mjs';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';
import {APPROVED_STRICT_SHORT_STAY_POLICY} from './cancellation-policy.mjs';
const id='11111111-1111-4111-8111-111111111111',nowEpoch=1800000000;
const secret='local-staging-synthetic-internal-secret-123';
const body=JSON.stringify({bookingId:id,issuedAt:nowEpoch});
const signature=createHmac('sha256',secret).update(body).digest('hex');
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',
 status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT',
 approvedAmountGBP:1630,holdExpiresAt:2000000000,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const checkout={bookingId:id,checkoutId:'checkout-12345678',reference:'booking-12345',
 currency:'GBP',amountPence:163000,status:'PENDING'};
const provider={id:checkout.checkoutId,checkout_reference:checkout.reference,
 merchant_code:'ABCDEF12',amount:1630,currency:'GBP',status:'PAID',
 transactions:[{id:'transaction-12345',status:'SUCCESSFUL',amount:1630,currency:'GBP',merchant_code:'ABCDEF12'}]};
const policy={PK:'CONFIG#cancellation#all',SK:'CURRENT',version:'2026-11-09T22:00:00.000Z#approved',value:APPROVED_STRICT_SHORT_STAY_POLICY};
function harness(providerResponse=provider){
 const claims=new Set();let writes=0,providerReads=0;
 const db={send:async command=>{
  if(command instanceof PutCommand){
   const key=command.input.Item.PK;
   if(claims.has(key))throw Error('ConditionalCheckFailedException');
   claims.add(key);return {};
  }
  if(command instanceof GetCommand){
   assert.equal(command.input.ConsistentRead,true);
   if(command.input.Key.PK==='CONFIG#cancellation#all')return {Item:policy};
   return {Item:command.input.Key.SK==='META'?booking:checkout};
  }
  if(command instanceof TransactWriteCommand){writes++;return {};}
  throw Error('Unexpected DynamoDB operation');
 }};
 const reconcile=({bookingId})=>reconcileVerifiedPayment({db,table:'les-buttes-booking-staging-BookingTable-LB08FIXTURE',
  bookingId,merchantCode:'ABCDEF12',nowEpoch,
  fetchCheckout:async checkoutId=>{providerReads++;assert.equal(checkoutId,checkout.checkoutId);
   return providerResponse;}});
 return {db,reconcile,get writes(){return writes;},get providerReads(){return providerReads;}};
}
const run=h=>processSignedInternalPaymentTrigger({body,signature,secret,db:h.db,
 table:'les-buttes-booking-staging-BookingTable-LB08FIXTURE',nowEpoch,enabled:true,reconcile:h.reconcile});
test('signed internal trigger verifies provider, conditionally confirms seven nights and blocks replay',async()=>{
 const h=harness(),result=await run(h);
 assert.equal(result.status,'CONFIRMED');
 assert.equal(result.affectedNights,7);
 assert.equal(h.writes,1);assert.equal(h.providerReads,1);
 await assert.rejects(run(h),/ConditionalCheckFailedException/);
 assert.equal(h.writes,1);assert.equal(h.providerReads,1);
});
test('signed trigger cannot confirm an unpaid provider checkout',async()=>{
 const h=harness({...provider,status:'PENDING'});
 await assert.rejects(run(h),/Payment not verified/);
 assert.equal(h.writes,0);assert.equal(h.providerReads,1);
 await assert.rejects(run(h),/ConditionalCheckFailedException/);
 assert.equal(h.writes,0);
});
test('tampered signature causes no provider read or DynamoDB writes',async()=>{
 const h=harness();
 await assert.rejects(processSignedInternalPaymentTrigger({body,
  signature:'f'.repeat(64),secret,db:h.db,table:'les-buttes-booking-staging-BookingTable-LB08FIXTURE',nowEpoch,
  enabled:true,reconcile:h.reconcile}),/Unauthorised/);
 assert.equal(h.writes,0);assert.equal(h.providerReads,0);
});

test('simultaneous delivery wins one replay claim and runs reconciliation once',async()=>{
 const claims=new Set();let reconciliations=0;
 const db={send:async command=>{
  assert.ok(command instanceof PutCommand);
  // Yield before claiming to exercise concurrent invocations in the mock.
  await Promise.resolve();
  const key=command.input.Item.PK;
  if(claims.has(key))throw Error('ConditionalCheckFailedException');
  claims.add(key);return {};
 }};
 const reconcile=async()=>{reconciliations++;return {status:'CONFIRMED'};};
 const args={body,signature,secret,db,table:'les-buttes-booking-staging-BookingTable-LB08FIXTURE',nowEpoch,enabled:true,reconcile};
 const outcomes=await Promise.allSettled([
  processSignedInternalPaymentTrigger(args),processSignedInternalPaymentTrigger(args)]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(v=>v.status==='rejected').length,1);
 assert.equal(reconciliations,1);
 assert.equal(claims.size,1);
});
test('reconciliation failure consumes trigger claim and requires a fresh authorised action',async()=>{
 const claims=new Set();let reconciliations=0;
 const db={send:async command=>{
  const key=command.input.Item.PK;
  if(claims.has(key))throw Error('ConditionalCheckFailedException');
  claims.add(key);return {};
 }};
 const args={body,signature,secret,db,table:'les-buttes-booking-staging-BookingTable-LB08FIXTURE',nowEpoch,enabled:true,
  reconcile:async()=>{reconciliations++;throw Error('Provider unavailable');}};
 await assert.rejects(processSignedInternalPaymentTrigger(args),/Provider unavailable/);
 await assert.rejects(processSignedInternalPaymentTrigger(args),/ConditionalCheckFailedException/);
 assert.equal(reconciliations,1);
});
