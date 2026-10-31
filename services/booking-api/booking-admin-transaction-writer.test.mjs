import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
const id='11111111-1111-4111-8111-111111111111';
const base={id,status:'REQUESTED',holdExpiresAt:200,source:'direct',GSI1PK:'BOOKING_REQUESTS',reservationStatus:'PENDING_REVIEW',
 units:['geranium'],start:'2027-08-28',end:'2027-08-30'};
const owner={role:'owner',subject:'owner-1'};
const make=(booking=base)=>{
 const sent=[];
 return {sent,params:{db:{send:async command=>{sent.push(command.input);return {};}},table:'staging-bookings',
   readBooking:async()=>booking,identity:owner,bookingId:id,nowEpoch:100}};
};
test('decline atomically releases all nights with metadata hold and status conditions',async()=>{
 const {sent,params}=make();
 const result=await executeOwnerTransition({...params,action:'decline'});
 assert.equal(result.id,id);
 assert.equal(result.from,'REQUESTED');
 assert.equal(result.to,'DECLINED');
 assert.equal(result.affectedNights,2);
 assert.match(result.auditId,/^[0-9a-f-]{36}$/);
 assert.equal(sent.length,1);
 assert.equal(sent[0].TransactItems.length,4);
 assert.equal(sent[0].TransactItems[3].Put.Item.actor,'owner-1');
 assert.equal(sent[0].TransactItems[3].Put.Item.action,'decline');
 assert.equal(sent[0].TransactItems[3].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':actor'],'owner-1');
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':action'],'decline');
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/holdExpiresAt > :now/);
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/holdExpiresAt = :observedExpiry/);
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/id = :id/);
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':observedExpiry'],200);
 assert.equal(sent[0].TransactItems[1].Delete.ConditionExpression,'id = :id AND expiresAt > :now');
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/#units = :observedUnits/);
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/#start = :observedStart/);
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/#end = :observedEnd/);
 assert.equal(sent[0].TransactItems[2].Delete.Key.SK,'DATE#2027-08-29');
});
test('cancel requires reason and releases confirmed booking without payment confirmation',async()=>{
 const {sent,params}=make({...base,status:'CONFIRMED',reservationStatus:'CONFIRMED'});
 await assert.rejects(executeOwnerTransition({...params,action:'cancel'}),/reason/);
 const result=await executeOwnerTransition({...params,action:'cancel',reason:'Guest requested cancellation'});
 assert.equal(result.to,'CANCELLED');
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':action'],'cancel');
 assert.equal(sent.length,1);
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':reason'],'Guest requested cancellation');
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':recordExpiry'],100+90*86400);
 assert.equal(sent[0].TransactItems[3].Put.Item.reason,'Guest requested cancellation');
});
test('rejects non-owner, unsupported approval, expired hold and mismatched booking',async()=>{
 const {sent,params}=make();
 await assert.rejects(executeOwnerTransition({...params,identity:{role:'admin'},action:'decline'}),/Forbidden/);
 await assert.rejects(executeOwnerTransition({...params,action:'approve'}),/positive amount/);
 await assert.rejects(executeOwnerTransition({...params,action:'decline',nowEpoch:200}),/expired/);
 await assert.rejects(executeOwnerTransition({...params,action:'decline',readBooking:async()=>({...base,id:'22222222-2222-4222-8222-222222222222'})}),/mismatch/);
 assert.equal(sent.length,0);
});

test('DynamoDB transaction failure does not return a successful transition',async()=>{
 const {params}=make();
 params.db={send:async()=>{throw Error('TransactionCanceledException');}};
 await assert.rejects(executeOwnerTransition({...params,action:'decline'}),/TransactionCanceledException/);
});

test('approval atomically extends metadata and all cottage-night holds',async()=>{
 const previous=process.env.BOOKING_ENVIRONMENT;
 process.env.BOOKING_ENVIRONMENT='staging';
 try{
  const {sent,params}=make({...base,quote:{totalGBP:250}});
  const result=await executeOwnerTransition({...params,action:'approve',
   approval:{amountPence:25000,paymentUrl:'https://test.invalid/pay/abc'}});
  assert.equal(result.to,'APPROVED_AWAITING_PAYMENT');
  assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':action'],'approve');
  assert.equal(result.affectedNights,2);
  assert.equal(sent.length,1);
  const items=sent[0].TransactItems;
  assert.equal(items.length,4);
  assert.equal(items[3].Put.Item.action,'approve');
  assert.equal(items[3].Put.Item.approvedAmountGBP,250);
  assert.match(items[0].Update.ConditionExpression,/quote = :observedQuote/);
  assert.deepEqual(items[0].Update.ExpressionAttributeValues[':observedQuote'],{totalGBP:250});
  assert.equal(items[0].Update.ExpressionAttributeValues[':nextExpiry'],100+48*3600);
  assert.equal(items[1].Update.ExpressionAttributeValues[':nextExpiry'],100+48*3600);
  assert.match(items[1].Update.ConditionExpression,/expiresAt > :now/);
  assert.equal(items[0].Update.ExpressionAttributeValues[':reservationStatus'],'AWAITING_PAYMENT');
 }finally{
  if(previous===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=previous;
 }
});
test('approval refuses mismatched amount without audit reason or unapproved URL',async()=>{
 const previous=process.env.BOOKING_ENVIRONMENT;
 process.env.BOOKING_ENVIRONMENT='staging';
 try{
  const {sent,params}=make({...base,quote:{totalGBP:250}});
  await assert.rejects(executeOwnerTransition({...params,action:'approve',
   approval:{amountPence:24000,paymentUrl:'https://test.invalid/pay/abc'}}),/audit reason/);
  await assert.rejects(executeOwnerTransition({...params,action:'approve',
   approval:{amountPence:25000,paymentUrl:'https://evil.example/pay'}}),/approved HTTPS/);
  assert.equal(sent.length,0);
 }finally{
  if(previous===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=previous;
 }
});

test('refuses an owner transition without an authenticated subject',async()=>{
 const {sent,params}=make();
 await assert.rejects(executeOwnerTransition({...params,action:'decline',identity:{role:'owner'}}),/subject required/);
 assert.equal(sent.length,0);
});

test('LB-01 rejects legacy blocks and inconsistent reservation classifications',async()=>{
 for(const booking of [
   {...base,source:'airbnb'},
   {...base,source:undefined},
   {...base,GSI1PK:undefined},
   {...base,reservationStatus:'AWAITING_PAYMENT'},
   {...base,status:'CONFIRMED',reservationStatus:'PENDING_REVIEW'}
 ]){
   const {sent,params}=make(booking);
   const action=booking.status==='CONFIRMED'?'cancel':'decline';
   await assert.rejects(executeOwnerTransition({...params,action,reason:'Guest requested cancellation'}));
   assert.equal(sent.length,0);
 }
});

test('LB-02 cancellation checks allocation but permits slots without an expiry',async()=>{
 const {sent,params}=make({...base,status:'CONFIRMED',reservationStatus:'CONFIRMED'});
 await executeOwnerTransition({...params,action:'cancel',reason:'Guest requested cancellation'});
 const tx=sent[0].TransactItems;
 assert.equal(tx[1].Delete.ConditionExpression,'id = :id');
 assert.deepEqual(tx[0].Update.ExpressionAttributeValues[':observedUnits'],['geranium']);
 assert.equal(tx[0].Update.ExpressionAttributeValues[':observedStart'],'2027-08-28');
 assert.equal(tx[0].Update.ExpressionAttributeValues[':observedEnd'],'2027-08-30');
});
test('LB-02 transaction cancellation propagates without reporting a successful audit',async()=>{
 const {params}=make();
 let calls=0;
 params.db={send:async command=>{
   calls++;
   assert.equal(command.input.TransactItems.length,4);
   throw Object.assign(new Error('Conditional check failed'),{name:'TransactionCanceledException'});
 }};
 await assert.rejects(executeOwnerTransition({...params,action:'decline'}),/Conditional check failed/);
 assert.equal(calls,1);
});
