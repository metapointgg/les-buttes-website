import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareConfirmedGuestEmail} from './booking-confirmation-email-preparation.mjs';
const booking={id:'11111111-1111-4111-8111-111111111111',source:'direct',
 status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paidAt:'2026-11-05T08:00:00.000Z',paymentTransactionId:'sumup-transaction-123',
 guestEmail:'guest@example.invalid',units:['geranium','honeysuckle'],
 start:'2027-08-28',end:'2027-09-04'};
test('confirmed guest email uses authoritative booking dates, cottages and recipient',()=>{
 const email=prepareConfirmedGuestEmail(booking);
 assert.equal(email.to,'guest@example.invalid');
 assert.equal(email.type,'confirmed');
 assert.equal(email.templateId,'confirmed_v1');
 assert.match(email.body,/Geranium and Honeysuckle/);
 assert.match(email.body,/2027-08-28 to 2027-09-04/);
 assert.doesNotMatch(email.body,/sumup-transaction-123/);
});
test('pending, unverified and malformed booking records cannot prepare confirmation',()=>{
 for(const changes of [
  {status:'APPROVED_AWAITING_PAYMENT'},{reservationStatus:'AWAITING_PAYMENT'},
  {paidAt:null},{paymentTransactionId:null},{guestEmail:null},
  {units:['unknown']},{units:['geranium','geranium']},{source:'airbnb'}
 ])assert.throws(()=>prepareConfirmedGuestEmail({...booking,...changes}));
});
