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
 {amountPence:100,outstandingPence:0,currency:'GBP',transactionId:tx,refundEvents:1});
});
test('partial refund, wrong merchant, wrong transaction, pending refund and missing events fail closed',()=>{
 const variants=[
  [{...provider,refunded_amount:1.01},'aggregate conflicts with events'],
  [{...provider,merchant_code:'MGV5J9QV'},'mismatch'],
  [{...provider,id:'66666666-7777-4888-8999-000000000000'},'mismatch'],
  [{...provider,transaction_events:[{event_type:'REFUND',status:'PENDING',amount:1}]},'Refund event not complete'],
  [{...provider,transaction_events:[]},'refund events'],
  [{...provider,status:'FAILED'},'not eligible'],
  [{...provider,transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:.97}]},'aggregate conflicts with events']
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
 assert.equal(result.outstandingPence,0);
 assert.equal(operations.length,1);
 const actions=operations[0].TransactItems;
 assert.equal(actions.length,4);
 assert.deepEqual(actions.map(x=>Object.keys(x)[0]),['ConditionCheck','Update','Put','Put']);
 assert.equal(actions[1].Update.ExpressionAttributeValues[':amount'],100);
 assert.equal(actions[2].Put.Item.state,'REFUNDED');
 assert.equal(actions[2].Put.Item.amountPence,100);
 assert.equal(actions[2].Put.Item.outstandingPence,0);
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
  fetchTransaction:async()=>({...provider,refunded_amount:0})}),/aggregate conflicts with events/);
 assert.equal(writes,0);
});

test('97p partial refund is recorded as PARTIALLY_REFUNDED with 3p outstanding',async()=>{
 const operations=[];
 const db={send:async cmd=>{
  if(cmd.input.Key)return {Item:booking};
  operations.push(cmd.input);return {};
 }};
 const partial={...provider,refunded_amount:.97,
  transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:.97},
   {event_type:'PAYOUT_DEDUCTION',status:'SUCCESSFUL',amount:.03}]};
 const verified=verifyProductionRefundEvidence({booking,transaction:partial,merchantCode:'M9BE4KMN'});
 assert.equal(verified.amountPence,97);
 assert.equal(verified.outstandingPence,3);
 const outcome=await reconcileVerifiedProductionRefund({db,table,bookingId:id,identity:owner,
  merchantCode:'M9BE4KMN',fetchTransaction:async()=>partial});
 assert.equal(outcome.status,'PARTIALLY_REFUNDED');
 assert.equal(outcome.amountPence,97);
 assert.equal(outcome.outstandingPence,3);
 const items=operations[0].TransactItems;
 assert.equal(items[1].Update.ExpressionAttributeValues[':next'],'PARTIALLY_REFUNDED');
 assert.equal(items[2].Put.Item.state,'PARTIALLY_REFUNDED');
 assert.equal(items[3].Put.Item.action,'partial_refund_verified');
});
test('repeated partial verification is idempotent; subsequent full refund upgrades state',async()=>{
 const partial={...provider,refunded_amount:.97,
  events:[{type:'REFUND',status:'REFUNDED',amount:.97}],transaction_events:undefined};
 const recorded={...booking,refundStatus:'PARTIALLY_REFUNDED',refundedAmountPence:97};
 let writes=0;
 const db={send:async cmd=>{
  if(cmd.input.Key)return {Item:recorded};
  writes++;return {};
 }};
 const prior=await reconcileVerifiedProductionRefund({db,table,bookingId:id,identity:owner,
  merchantCode:'M9BE4KMN',fetchTransaction:async()=>partial});
 assert.equal(prior.status,'ALREADY_PARTIALLY_REFUNDED');
 assert.equal(writes,0);
 const next=await reconcileVerifiedProductionRefund({db,table,bookingId:id,identity:owner,
  merchantCode:'M9BE4KMN',fetchTransaction:async()=>provider});
 assert.equal(next.status,'REFUNDED');
 assert.equal(next.outstandingPence,0);
 assert.equal(writes,1);
});

test('actual SumUp 13 November response reconciles a 97p refund despite SUCCESSFUL transaction status',()=>{
 const actual={id:tx,merchant_code:'M9BE4KMN',currency:'GBP',amount:1,
  status:'SUCCESSFUL',simple_status:'SUCCESSFUL',
  transaction_events:[
   {event_type:'PAYOUT',status:'PENDING',amount:.97},
   {event_type:'REFUND',status:'REFUNDED',amount:.97}
  ],
  events:[
   {type:'PAYOUT',status:'SCHEDULED',amount:.97},
   {type:'REFUND',status:'REFUNDED',amount:.97}
  ]};
 assert.deepEqual(verifyProductionRefundEvidence({
  booking,transaction:actual,merchantCode:'M9BE4KMN'
 }),{amountPence:97,outstandingPence:3,currency:'GBP',transactionId:tx,refundEvents:1});
 assert.throws(()=>verifyProductionRefundEvidence({
  booking,transaction:{...actual,events:[{type:'REFUND',status:'REFUNDED',amount:1}]},
  merchantCode:'M9BE4KMN'}),/sources disagree/);
 assert.throws(()=>verifyProductionRefundEvidence({
  booking,transaction:{...actual,transaction_events:[{event_type:'REFUND',status:'PENDING',amount:.97}]},
  merchantCode:'M9BE4KMN'}),/not complete/);
});

test('full £805 deposit+balance cancellation checks both SumUp refund streams and never confuses fees',async()=>{
 const second='22222222-2222-4222-8222-222222222222';
 const multi={...booking,paymentTransactionId:tx,balanceTransactionId:second,
  paidAmountPence:80500,refundDuePence:80500,
  paymentSchedule:{totalPence:80500,dueNowPence:40250,balancePence:40250}};
 const providerFor=(id,amount,refund)=>({
  id,merchant_code:'M9BE4KMN',currency:'GBP',amount,status:'SUCCESSFUL',simple_status:'SUCCESSFUL',
  transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:refund}],
  events:[{type:'REFUND',status:'REFUNDED',amount:refund}]});
 const first=providerFor(tx,402.5,402.5),last=providerFor(second,402.5,402.47);
 const verify=async txid=>txid===tx?first:last;
 const evidence=await verifyMultiInstalmentRefundEvidence({
  booking:multi,merchantCode:'M9BE4KMN',fetchTransaction:verify});
 assert.equal(evidence.amountPence,80497);
 assert.equal(evidence.outstandingPence,3);
 assert.deepEqual(evidence.refundAmountsPence,[40250,40247]);
 const db={send:async command=>{
  if(command.input.Key?.SK==='META')return {Item:multi};
  assert.equal(command.input.TransactItems.filter(x=>x.ConditionCheck).length,2);
  assert.equal(command.input.TransactItems[1].ConditionCheck.ExpressionAttributeValues[':stage'],'BALANCE');
  return {};
 }};
 const saved=await reconcileVerifiedProductionRefund({
  db,table,bookingId:id,identity:owner,merchantCode:'M9BE4KMN',fetchTransaction:verify});
 assert.equal(saved.status,'PARTIALLY_REFUNDED');
 assert.equal(saved.outstandingPence,3);
});
test('multi-payment refund does not reconcile if either provider transaction is invalid',async()=>{
 const second='22222222-2222-4222-8222-222222222222';
 const multi={...booking,paymentTransactionId:tx,balanceTransactionId:second,
  paidAmountPence:80500,refundDuePence:80500,
  paymentSchedule:{totalPence:80500,dueNowPence:40250,balancePence:40250}};
 await assert.rejects(verifyMultiInstalmentRefundEvidence({booking:multi,
  merchantCode:'M9BE4KMN',fetchTransaction:async identity=>({
   id:identity,merchant_code:identity===tx?'M9BE4KMN':'OTHER',currency:'GBP',
   amount:402.5,status:'SUCCESSFUL',simple_status:'SUCCESSFUL',
   transaction_events:[{event_type:'REFUND',status:'REFUNDED',amount:402.5}]})}),/mismatch/);
});
