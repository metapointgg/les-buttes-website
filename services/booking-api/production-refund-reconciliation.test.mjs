import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductionRefundEvidence,reconcileVerifiedProductionRefund}
 from './production-refund-reconciliation.mjs';

const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const id='884cd893-36cc-4a75-81f4-f1d5b18f8a9b';
const tx='11111111-2222-4333-8444-555555555555';
const owner={role:'owner',subject:'test-owner-id'};
const booking={id,source:'direct',status:'CANCELLED',reservationStatus:'CANCELLED',
 refundStatus:'ASSESSED',refundDuePence:100,paidAmountPence:100,paymentTransactionId:tx};
const provider={id:tx,merchant_code:'M9BE4KMN',currency:'GBP',amount:1,
 status:'REFUNDED',simple_status:'REFUNDED',refunded_amount:1,
 transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:1},
 {event_type:'PAYOUT_DEDUCTION',status:'SUCCESSFUL',amount:0.03}]};

test('full guest refund excludes merchant payout deductions',()=>{
 assert.deepEqual(verifyProductionRefundEvidence({
  booking,transaction:provider,merchantCode:'M9BE4KMN'}),
 {amountPence:100,currency:'GBP',transactionId:tx,refundEvents:1});
});
test('partial refund, wrong merchant, wrong transaction, pending refund and missing events fail closed',()=>{
 const variants=[
  [{...provider,refunded_amount:.97},'SumUp refund not verified'],
  [{...provider,merchant_code:'MGV5J9QV'},'mismatch'],
  [{...provider,id:'66666666-7777-4888-8999-000000000000'},'mismatch'],
  [{...provider,transaction_events:[{event_type:'REFUND',status:'PENDING',amount:1}]},'refund events'],
  [{...provider,transaction_events:[]},'refund events'],
  [{...provider,status:'SUCCESSFUL'},'SumUp refund not verified'],
  [{...provider,transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:.97}]},'refund events']
 ];
 for(const [transaction,pattern] of variants)
  assert.throws(()=>verifyProductionRefundEvidence({
   booking,transaction,merchantCode:'M9BE4KMN'}),new RegExp(pattern));
});
test('owner reconciliation writes atomic refund claim, ledger and audit, never requests refund',async()=>{
 const operations=[],reads=[];
 const db={send:async cmd=>{
  if(cmd.input.Key){reads.push(cmd.input.Key);return {Item:booking};}
  operations.push(cmd.input);return {};
 }};
 const result=await reconcileVerifiedProductionRefund({db,table,bookingId:id,identity:owner,
  merchantCode:'M9BE4KMN',fetchTransaction:async given=>{
   assert.equal(given,tx);return provider;
  },now:()=> '2026-11-13T12:00:00.000Z'});
 assert.equal(result.status,'REFUNDED');
 assert.equal(result.amountPence,100);
 assert.equal(operations.length,1);
 const actions=operations[0].TransactItems;
 assert.equal(actions.length,4);
 assert.deepEqual(actions.map(x=>Object.keys(x)[0]),['ConditionCheck','Update','Put','Put']);
 assert.equal(actions[1].Update.ExpressionAttributeValues[':amount'],100);
 assert.equal(actions[2].Put.Item.state,'REFUNDED');
 assert.equal(actions[2].Put.Item.amountPence,100);
 assert.equal(actions[3].Put.Item.action,'refund_verified');
 assert.equal(actions[3].Put.Item.actor,'test-owner-id');
 assert.equal(reads.length,1);
});
test('verified repeated reconciliation reads provider but does not duplicate ledger entries',async()=>{
 let writes=0,lookup=0;
 const db={send:async cmd=>{
  if(!cmd.input.Key){writes++;throw Error('Duplicate write');}
  return {Item:{...booking,refundStatus:'REFUNDED',refundedAmountPence:100}};
 }};
 const r=await reconcileVerifiedProductionRefund({db,table,bookingId:id,identity:owner,
  merchantCode:'M9BE4KMN',fetchTransaction:async()=>{lookup++;return provider;}});
 assert.equal(r.status,'ALREADY_REFUNDED');
 assert.equal(writes,0);
 assert.equal(lookup,1);
});
test('not paid, unauthorised or provider mismatch causes no ledger write',async()=>{
 let writes=0;
 const db={send:async cmd=>{
  if(!cmd.input.Key){writes++;throw Error('Unexpected write');}
  return {Item:booking};
 }};
 for(const identity of [null,{role:'viewer',subject:'viewer-id'}])
  await assert.rejects(reconcileVerifiedProductionRefund({
   db,table,bookingId:id,identity,merchantCode:'M9BE4KMN',
   fetchTransaction:async()=>provider}),/unavailable/);
 await assert.rejects(reconcileVerifiedProductionRefund({
  db,table,bookingId:id,identity:owner,merchantCode:'M9BE4KMN',
  fetchTransaction:async()=>({...provider,refunded_amount:0})}),/not verified/);
 assert.equal(writes,0);
});
