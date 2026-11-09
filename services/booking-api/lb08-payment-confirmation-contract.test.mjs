// LB-08 isolated booking-confirmation contract acceptance.
// Deliberately exercises the production reconciliation functions with an in-memory
// DynamoDB command adapter; no AWS calls, no cottage slot writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';
const id='62c87df7-66b5-49ed-a56f-5da0f16ea382';
const checkoutId='eb6a0f73-c344-42b4-95ec-70aa296d1496';
const txId='ecebc6e9-5f74-4d39-be1f-caf2b26a7cd3';
const merchantCode='MGV5J9QV';
const reference='lb08_synthetic_contract';
const nowEpoch=Math.floor(Date.parse('2026-11-02T22:00:00Z')/1000);
const holdExpiresAt=nowEpoch+3600;
const booking={id,PK:'BOOKING#'+id,SK:'META',source:'direct',
 GSI1PK:'BOOKING_REQUESTS',status:'APPROVED_AWAITING_PAYMENT',
 reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:1,holdExpiresAt,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const registered={PK:'BOOKING#'+id,SK:'PAYMENT#CHECKOUT',
 bookingId:id,checkoutId,reference,amountPence:100,currency:'GBP',status:'PENDING'};
const provider={id:checkoutId,checkout_reference:reference,merchant_code:merchantCode,
 amount:1,currency:'GBP',status:'PAID',transactions:[{
 id:txId,status:'SUCCESSFUL',amount:1,currency:'GBP',merchant_code:merchantCode}]};
const table='les-buttes-booking-staging-BookingTable-LB08FIXTURE';
function adapter(){
 const commands=[];let state='AWAITING_PAYMENT';let auditWrites=0;
 return {commands,get auditWrites(){return auditWrites;},
 db:{send:async command=>{
  commands.push(command);
  if(command instanceof GetCommand){
   assert.equal(command.input.TableName,table);
   assert.equal(command.input.ConsistentRead,true);
   const {PK,SK}=command.input.Key;
   if(PK==='BOOKING#'+id&&SK==='META')
    return {Item:state==='CONFIRMED'?{...booking,status:'CONFIRMED',
      reservationStatus:'CONFIRMED',paymentTransactionId:txId,
      paidAt:'2026-11-02T22:00:00.000Z'}:booking};
   if(PK==='BOOKING#'+id&&SK==='PAYMENT#CHECKOUT')return {Item:registered};
   if(PK==='PAYMENT_TRANSACTION#'+txId&&SK==='CONFIRMATION')
    return {Item:state==='CONFIRMED'?{bookingId:id,checkoutId,amountPence:100,currency:'GBP'}:undefined};
   return {Item:undefined};
  }
  assert.ok(command instanceof TransactWriteCommand);
  const operations=command.input.TransactItems;
  assert.equal(operations.length,11);
  assert.ok(operations.every(op=>Object.values(op)[0].TableName===table));
  assert.deepEqual(operations[0].Update.Key,{PK:'BOOKING#'+id,SK:'META'});
  assert.deepEqual(operations[1].ConditionCheck.Key,{PK:'BOOKING#'+id,SK:'PAYMENT#CHECKOUT'});
  assert.deepEqual(operations.slice(2,9).map(op=>op.Update.Key),
   Array.from({length:7},(_,i)=>({PK:'UNIT#geranium',
     SK:'DATE#2027-08-'+String(28+i).padStart(2,'0')}))
     .map((key,i)=>i<4?key:{PK:key.PK,SK:'DATE#2027-09-0'+(i-3)}));
  for(const slot of operations.slice(2,9)){
   assert.match(slot.Update.ConditionExpression,/id = :id AND expiresAt = :expiry/);
   assert.equal(slot.Update.ExpressionAttributeValues[':id'],id);
  }
  assert.equal(operations[9].Put.Item.PK,'PAYMENT_TRANSACTION#'+txId);
  assert.equal(operations[9].Put.Item.amountPence,100);
  assert.equal(operations[10].Put.Item.action,'payment_confirmed');
  if(state==='CONFIRMED')
   throw Object.assign(new Error('Transaction cancelled'),{name:'TransactionCanceledException'});
  state='CONFIRMED';auditWrites++;return {};
 }}};
}
test('LB-08 sandbox-shaped evidence prepares one eleven-operation atomic confirmation',async()=>{
 const a=adapter();
 const result=await reconcileVerifiedPayment({db:a.db,table,bookingId:id,
  merchantCode,nowEpoch,fetchCheckout:async requested=>{
   assert.equal(requested,checkoutId);return provider;}});
 assert.equal(result.status,'CONFIRMED');assert.equal(result.affectedNights,7);
 assert.equal(a.auditWrites,1);
 assert.equal(a.commands.filter(c=>c instanceof TransactWriteCommand).length,1);
});
test('LB-08 provider mismatch prevents any confirmation transaction',async()=>{
 const a=adapter();
 await assert.rejects(reconcileVerifiedPayment({db:a.db,table,bookingId:id,
  merchantCode,nowEpoch,fetchCheckout:async()=>({...provider,transactions:[]})}),
 /Successful provider transaction missing/);
 assert.equal(a.commands.some(c=>c instanceof TransactWriteCommand),false);
});
