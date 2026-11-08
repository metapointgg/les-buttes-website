import test from 'node:test';import assert from 'node:assert/strict';
import {preparePaymentConfirmation} from './sumup-payment-confirmation.mjs';
const id='11111111-1111-4111-8111-111111111111';
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',status:'APPROVED_AWAITING_PAYMENT',
 reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:1630,holdExpiresAt:2000000000,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const registered={checkoutId:'checkout-12345678',reference:'booking-12345',amountPence:163000};
const evidence={verified:true,bookingId:id,checkoutId:registered.checkoutId,reference:registered.reference,
 amountPence:163000,currency:'GBP',transactionId:'transaction-12345'};
const prepare=(overrides={})=>preparePaymentConfirmation({booking,registered,evidence,nowEpoch:1800000000,...overrides});
test('LB-08 confirmation atomically changes booking and seven nights, deduplicates payment and audits',()=>{
 const {items,affectedNights}=prepare();
 assert.equal(affectedNights,7);assert.equal(items.length,11);
 assert.equal(items[0].Update.ExpressionAttributeValues[':confirmed'],'CONFIRMED');
 assert.match(items[0].Update.ConditionExpression,/holdExpiresAt > :now/);
 assert.match(items[0].Update.UpdateExpression,/REMOVE expiresAt, holdExpiresAt/,
  'a paid booking must survive beyond the temporary request TTL');
 assert.equal(items[1].ConditionCheck.Key.SK,'PAYMENT#CHECKOUT');
 for(const slot of items.slice(2,9)){
  assert.match(slot.Update.UpdateExpression,/REMOVE expiresAt/);
  assert.match(slot.Update.ConditionExpression,/expiresAt = :expiry/);
 }
 assert.equal(items[9].Put.Item.PK,'PAYMENT_TRANSACTION#transaction-12345');
 assert.equal(items[9].Put.Item.amountPence,163000);
 assert.equal(items[9].Put.Item.currency,'GBP');
 assert.equal(items[9].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(items[10].Put.Item.action,'payment_confirmed');
});
test('LB-08 confirmation rejects stale holds and altered booking status',()=>{
 assert.throws(()=>prepare({booking:{...booking,holdExpiresAt:1800000000}}),/not eligible/);
 assert.throws(()=>prepare({booking:{...booking,status:'CONFIRMED'}}),/not eligible/);
 assert.throws(()=>prepare({booking:{...booking,approvedAmountGBP:1}}),/not eligible/);
});
test('LB-08 confirmation rejects unverified or mismatched payment evidence',()=>{
 assert.throws(()=>prepare({evidence:{...evidence,verified:false}}),/evidence/);
 assert.throws(()=>prepare({evidence:{...evidence,amountPence:1}}),/evidence/);
 assert.throws(()=>prepare({evidence:{...evidence,checkoutId:'different'}}),/evidence/);
});
