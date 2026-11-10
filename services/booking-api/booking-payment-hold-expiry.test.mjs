import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {expireApprovedPaymentHold} from './booking-payment-hold-expiry.mjs';

const table='les-buttes-booking-staging-BookingTable-TEST123';
const booking={id:'11111111-1111-4111-8111-111111111111',source:'direct',synthetic:true,
 guestEmail:'test@example.invalid',status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT',
 holdExpiresAt:100,units:['geranium'],start:'2027-06-05',end:'2027-06-12'};

test('expired approved payment hold atomically expires metadata, releases every night and audits',async()=>{
 let transaction;
 const db={send:async command=>{assert.ok(command instanceof TransactWriteCommand);transaction=command.input;return {};}};
 const result=await expireApprovedPaymentHold({db,table,booking,nowEpoch:101});
 assert.equal(result.status,'EXPIRED');
 assert.equal(result.affectedNights,7);
 assert.equal(transaction.TransactItems.length,9);
 assert.equal(transaction.TransactItems.filter(item=>item.Delete).length,7);
 const update=transaction.TransactItems[0].Update;
 assert.equal(update.ExpressionAttributeValues[':expired'],'EXPIRED');
 assert.equal(update.ExpressionAttributeValues[':observed'],100);
 assert.equal(update.ExpressionAttributeValues[':now'],101);
 assert.equal(transaction.TransactItems.at(-1).Put.Item.action,'payment_hold_expired');
});

test('lost expiry response returns idempotently only after a strong authoritative read',async()=>{
 let calls=0;
 const db={send:async command=>{
  calls++;
  if(command instanceof TransactWriteCommand)throw Object.assign(Error('timeout'),{name:'TimeoutError'});
  assert.ok(command instanceof GetCommand);
  assert.equal(command.input.ConsistentRead,true);
  return {Item:{status:'EXPIRED',reservationStatus:'EXPIRED'}};
 }};
 const result=await expireApprovedPaymentHold({db,table,booking,nowEpoch:101});
 assert.equal(result.status,'ALREADY_EXPIRED');
 assert.equal(calls,2);
});

test('unexpired, foreign and non-synthetic bookings cannot be expired',async()=>{
 const db={send:async()=>{throw Error('must not write');}};
 for(const changed of [{holdExpiresAt:102},{source:'airbnb'},{synthetic:false},{status:'CONFIRMED'}])
  await assert.rejects(expireApprovedPaymentHold({db,table,booking:{...booking,...changed},nowEpoch:101}),
   /Expired synthetic payment hold required/);
});
