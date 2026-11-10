import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBookingCancellation} from './booking-cancellation-assessment.mjs';
import {APPROVED_STRICT_SHORT_STAY_POLICY} from './cancellation-policy.mjs';
const version='2026-11-09T22:00:00.000Z#approved';
const policyRecord={PK:'CONFIG#cancellation#all',SK:'VERSION#'+version,version,value:APPROVED_STRICT_SHORT_STAY_POLICY};
const booking={source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 cancellationPolicyVersion:version,cancellationPolicyId:APPROVED_STRICT_SHORT_STAY_POLICY.policyId,
 arrivalDepartureVersion:'arrival-v1',confirmedAt:'2027-03-01T12:00:00Z',
 paidAt:'2027-03-01T12:00:00Z',paidAmountPence:73500,paymentTransactionId:'transaction-12345',
 checkInAt:'2027-04-03T14:00:00+01:00',start:'2027-04-03',end:'2027-04-10'};
test('assessment uses immutable booking policy and exact paid amount',()=>{
 assert.deepEqual(assessBookingCancellation({booking,policyRecord,cancelledAt:'2027-03-20T12:00:00Z'}),{
  policyId:APPROVED_STRICT_SHORT_STAY_POLICY.policyId,policyVersion:version,refundPercent:50,
  refundAmountPence:36750,feePence:0,reason:'AT_LEAST_7_DAYS_BEFORE_CHECK_IN',
  cancellationReceivedAt:'2027-03-20T12:00:00Z',checkInAt:booking.checkInAt,
  paymentTransactionId:'transaction-12345'});
});
test('assessment rejects current, changed or missing policy snapshots',()=>{
 assert.throws(()=>assessBookingCancellation({booking,policyRecord:{...policyRecord,SK:'CURRENT'},cancelledAt:'2027-03-20T12:00:00Z'}));
 assert.throws(()=>assessBookingCancellation({booking:{...booking,cancellationPolicyVersion:'other'},policyRecord,cancelledAt:'2027-03-20T12:00:00Z'}));
 assert.throws(()=>assessBookingCancellation({booking:{...booking,checkInAt:undefined},policyRecord,cancelledAt:'2027-03-20T12:00:00Z'}));
});
