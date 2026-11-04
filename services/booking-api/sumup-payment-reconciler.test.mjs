import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';
const id='11111111-1111-4111-8111-111111111111';
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',status:'APPROVED_AWAITING_PAYMENT',
 reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:1630,holdExpiresAt:2000000000,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const registered={bookingId:id,checkoutId:'checkout-12345678',reference:'booking-12345',
 amountPence:163000,currency:'GBP',status:'PENDING'};
const provider={id:registered.checkoutId,checkout_reference:registered.reference,
 merchant_code:'merchant-1',currency:'GBP',amount:1630,status:'PAID',
 transactions:[{status:'SUCCESSFUL',id:'transaction-12345',amount:1630,currency:'GBP',merchant_code:'merchant-1'}]};
function setup({bookingRecord=booking,checkoutRecord=registered,providerRecord=provider,writeError}={}){
 const commands=[];
 const db={send:async command=>{
  commands.push(command);
  if(command instanceof GetCommand){
   assert.equal(command.input.ConsistentRead,true);
   return {Item:command.input.Key.SK==='META'?bookingRecord:checkoutRecord};
  }
  if(command instanceof TransactWriteCommand){
   if(writeError)throw writeError;
   return {};
  }
  throw Error('Unexpected command');
 }};
 let providerCalls=0;
 const fetchCheckout=async checkoutId=>{
  providerCalls++;
  assert.equal(checkoutId,registered.checkoutId);
  return providerRecord;
 };
 return {db,commands,fetchCheckout,get providerCalls(){return providerCalls;}};
}
const run=(s,extra={})=>reconcileVerifiedPayment({db:s.db,table:'les-buttes-bookings-staging',
 bookingId:id,fetchCheckout:s.fetchCheckout,merchantCode:'merchant-1',nowEpoch:1800000000,...extra});
test('LB-08 fresh provider evidence authorises one atomic confirmation and audit',async()=>{
 const s=setup(),result=await run(s);
 assert.equal(result.status,'CONFIRMED');
 assert.equal(result.affectedNights,7);
 assert.equal(s.providerCalls,1);
 assert.equal(s.commands.length,3);
 const tx=s.commands[2];
 assert.ok(tx instanceof TransactWriteCommand);
 assert.equal(tx.input.TransactItems.length,11);
 assert.ok(tx.input.TransactItems.every(x=>Object.values(x)[0].TableName==='les-buttes-bookings-staging'));
 assert.equal(tx.input.TransactItems[9].Put.Item.PK,'PAYMENT_TRANSACTION#transaction-12345');
});
test('LB-08 rejects forged payment and cannot write',async()=>{
 const s=setup({providerRecord:{...provider,status:'PENDING'}});
 await assert.rejects(run(s),/Payment not verified/);
 assert.equal(s.commands.length,2);
});
test('LB-08 rejects merchant mismatch and cannot write',async()=>{
 const s=setup({providerRecord:{...provider,merchant_code:'other-merchant'}});
 await assert.rejects(run(s),/Merchant identity mismatch/);
 assert.equal(s.commands.length,2);
});
test('LB-08 rejects changed or expired booking before transaction',async()=>{
 const s=setup({bookingRecord:{...booking,holdExpiresAt:1800000000}});
 await assert.rejects(run(s),/not eligible/);
 assert.equal(s.commands.length,2);
});
test('LB-08 duplicate replay cannot produce a successful response if transaction fails',async()=>{
 const s=setup({writeError:new Error('TransactionCanceledException')});
 await assert.rejects(run(s),/TransactionCanceledException/);
 assert.equal(s.commands.length,5);
});
test('LB-08 prevents production table access before reading or calling provider',async()=>{
 const s=setup();
 await assert.rejects(run(s,{table:'les-buttes-bookings-production'}),/not configured/);
 assert.equal(s.commands.length,0);
 assert.equal(s.providerCalls,0);
});

test('LB-08 lost DynamoDB response recovers only matching atomic confirmation claim',async()=>{
 let writes=0;
 const db={send:async command=>{
  if(command instanceof TransactWriteCommand){writes++;throw Error('Socket disconnected');}
  const sk=command.input.Key.SK;
  assert.equal(command.input.ConsistentRead,true);
  if(sk==='PAYMENT#CHECKOUT')return {Item:registered};
  if(sk==='CONFIRMATION')return {Item:{bookingId:id,checkoutId:registered.checkoutId,amountPence:163000,currency:'GBP'}};
  return {Item:writes?{...booking,status:'CONFIRMED',reservationStatus:'CONFIRMED',
   paymentTransactionId:'transaction-12345',paidAt:'2027-01-01T00:00:00.000Z'}:booking};
 }};
 const result=await reconcileVerifiedPayment({db,table:'booking-staging',bookingId:id,
  merchantCode:'merchant-1',fetchCheckout:async()=>provider,nowEpoch:1800000000});
 assert.equal(result.status,'ALREADY_CONFIRMED');
 assert.equal(writes,1);
});
test('LB-08 rejects transaction claim associated with another booking',async()=>{
 let writes=0;
 const db={send:async command=>{
  if(command instanceof TransactWriteCommand){writes++;throw Error('TransactionCanceledException');}
  const sk=command.input.Key.SK;
  if(sk==='PAYMENT#CHECKOUT')return {Item:registered};
  if(sk==='CONFIRMATION')return {Item:{bookingId:'another',checkoutId:registered.checkoutId}};
  return {Item:writes?{...booking,status:'CONFIRMED',reservationStatus:'CONFIRMED',
   paymentTransactionId:'transaction-12345',paidAt:'2027-01-01T00:00:00.000Z'}:booking};
 }};
 await assert.rejects(reconcileVerifiedPayment({db,table:'booking-staging',bookingId:id,
  merchantCode:'merchant-1',fetchCheckout:async()=>provider,nowEpoch:1800000000}),
  /TransactionCanceledException/);
 assert.equal(writes,1);
});

test('LB-08 uncertain outcome rejects claim with mismatched amount',async()=>{
 let writes=0;
 const db={send:async command=>{
  if(command instanceof TransactWriteCommand){writes++;throw Error('Socket disconnected');}
  const sk=command.input.Key.SK;
  if(sk==='PAYMENT#CHECKOUT')return {Item:registered};
  if(sk==='CONFIRMATION')return {Item:{bookingId:id,checkoutId:registered.checkoutId,amountPence:1,currency:'GBP'}};
  return {Item:writes?{...booking,status:'CONFIRMED',reservationStatus:'CONFIRMED',
   paymentTransactionId:'transaction-12345',paidAt:'2027-01-01T00:00:00.000Z'}:booking};
 }};
 await assert.rejects(reconcileVerifiedPayment({db,table:'booking-staging',bookingId:id,
  merchantCode:'merchant-1',fetchCheckout:async()=>provider,nowEpoch:1800000000}),/Socket disconnected/);
 assert.equal(writes,1);
});
