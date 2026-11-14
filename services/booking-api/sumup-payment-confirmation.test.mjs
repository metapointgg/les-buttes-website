import test from 'node:test';import assert from 'node:assert/strict';
import {preparePaymentConfirmation} from './sumup-payment-confirmation.mjs';
import {APPROVED_STRICT_SHORT_STAY_POLICY} from './cancellation-policy.mjs';
const id='11111111-1111-4111-8111-111111111111';
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',status:'APPROVED_AWAITING_PAYMENT',
 reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:1630,holdExpiresAt:2000000000,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const registered={checkoutId:'checkout-12345678',reference:'booking-12345',amountPence:163000};
const evidence={verified:true,bookingId:id,checkoutId:registered.checkoutId,reference:registered.reference,
 amountPence:163000,currency:'GBP',transactionId:'transaction-12345'};
const cancellationPolicyRecord={PK:'CONFIG#cancellation#all',SK:'CURRENT',version:'2026-11-09T22:00:00.000Z#approved',value:APPROVED_STRICT_SHORT_STAY_POLICY};
const arrivalDepartureRecord={PK:'CONFIG#arrival-departure#all',SK:'CURRENT',version:'2026-11-10T00:00:00.000Z#approved',
 value:{timezone:'Europe/Guernsey',checkInLocalTime:'12:00',checkOutLocalTime:'10:00'}};
const prepare=(overrides={})=>preparePaymentConfirmation({booking,registered,evidence,cancellationPolicyRecord,arrivalDepartureRecord,nowEpoch:1800000000,...overrides});
test('LB-08 confirmation atomically changes booking and seven nights, deduplicates payment and audits',()=>{
 const {items,affectedNights}=prepare();
 assert.equal(affectedNights,7);assert.equal(items.length,13);
 assert.equal(items[0].Update.ExpressionAttributeValues[':confirmed'],'CONFIRMED');
 assert.match(items[0].Update.ConditionExpression,/holdExpiresAt > :now/);
 assert.match(items[0].Update.UpdateExpression,/REMOVE expiresAt, holdExpiresAt/,
  'a paid booking must survive beyond the temporary request TTL');
 assert.equal(items[1].ConditionCheck.Key.SK,'PAYMENT#CHECKOUT');
 assert.equal(items[2].ConditionCheck.Key.PK,'CONFIG#cancellation#all');
 assert.equal(items[3].ConditionCheck.Key.PK,'CONFIG#arrival-departure#all');
 assert.equal(items[0].Update.ExpressionAttributeValues[':checkInAt'],'2027-08-28T12:00:00+01:00');
 assert.equal(items[0].Update.ExpressionAttributeValues[':nights'],7);
 for(const slot of items.slice(4,11)){
  assert.match(slot.Update.UpdateExpression,/REMOVE expiresAt/);
  assert.match(slot.Update.ConditionExpression,/expiresAt = :expiry/);
 }
 assert.equal(items[11].Put.Item.PK,'PAYMENT_TRANSACTION#transaction-12345');
 assert.equal(items[11].Put.Item.amountPence,163000);
 assert.equal(items[11].Put.Item.currency,'GBP');
 assert.equal(items[11].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(items[12].Put.Item.action,'payment_confirmed');
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
test('confirmation fails closed without an approved arrival policy and rejects test times for real guests',()=>{
 assert.throws(()=>prepare({arrivalDepartureRecord:undefined}),/arrival and departure policy required/);
 assert.throws(()=>prepare({arrivalDepartureRecord:{...arrivalDepartureRecord,
  value:{...arrivalDepartureRecord.value,testOnly:true}},booking:{...booking,synthetic:false}}),/requires synthetic booking/);
});

test('£805 deposit confirms dates while retaining £402.50 balance due two weeks before arrival',()=>{
 const paymentSchedule={totalPence:80500,dueNowPence:40250,balancePence:40250,
  dueDate:'2027-08-14',depositPercent:50};
 const partial=prepare({
  booking:{...booking,approvedAmountGBP:805,paymentSchedule},
  registered:{...registered,amountPence:40250},
  evidence:{...evidence,amountPence:40250}
 });
 assert.equal(partial.items[0].Update.ExpressionAttributeValues[':amount'],805);
 assert.equal(partial.items[0].Update.ExpressionAttributeValues[':pence'],40250);
 assert.equal(partial.items[0].Update.ExpressionAttributeValues[':balancePence'],40250);
 assert.equal(partial.items[0].Update.ExpressionAttributeValues[':paymentStatus'],'PARTIALLY_PAID');
 assert.equal(partial.items[0].Update.ExpressionAttributeValues[':confirmed'],'CONFIRMED');
 assert.equal(partial.items[11].Put.Item.amountPence,40250);
});
