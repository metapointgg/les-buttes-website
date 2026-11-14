import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCancellationRefund,validateCancellationPolicy} from './cancellation-policy.mjs';

const policy={policyId:'DIRECT_AIRBNB_STRICT_SHORT_STAY_V1',appliesToMaxNights:27,
 timezone:'Europe/Guernsey',initialFullRefundHours:24,initialFullRefundMinimumLeadDays:7,
 tiers:[{daysBeforeArrival:7,refundPercent:50},{daysBeforeArrival:0,refundPercent:0}],
 afterCheckInRefundPercent:0,feesPence:{booking:0,administration:0,service:0,cancellation:0},
 nonRefundableOption:false,rounding:'HALF_UP_TO_PENNY',
 sourceUrl:'https://www.airbnb.com/help/article/475',verifiedOn:'2026-11-09'};
const booking={amountPaidPence:73501,nights:7,confirmedAt:'2027-03-01T12:00:00Z',checkInAt:'2027-04-03T15:00:00+01:00'};

test('approved strict short-stay policy has exact no-fee tiers',()=>assert.equal(validateCancellationPolicy(policy),true));
test('24-hour window is full only where confirmation was at least seven days before local check-in',()=>{
 assert.deepEqual(calculateCancellationRefund({policy,booking,cancelledAt:'2027-03-02T12:00:00Z'}),{
  policyId:policy.policyId,refundPercent:100,refundAmountPence:73501,feePence:0,
  reason:'WITHIN_24_HOURS_AND_CONFIRMED_AT_LEAST_7_DAYS_BEFORE_CHECK_IN',
  cancellationReceivedAt:'2027-03-02T12:00:00Z',checkInAt:booking.checkInAt});
 const lateConfirmation={...booking,confirmedAt:'2027-03-29T12:00:00Z'};
 assert.equal(calculateCancellationRefund({policy,booking:lateConfirmation,cancelledAt:'2027-03-29T13:00:00Z'}).refundPercent,0);
});
test('after free window gives 50 percent at seven days, rounded half up to a penny',()=>{
 const result=calculateCancellationRefund({policy,booking,cancelledAt:'2027-03-27T14:00:00Z'});
 assert.equal(result.refundPercent,50);assert.equal(result.refundAmountPence,36751);assert.equal(result.feePence,0);
});
test('less than seven days and at or after check-in give no ordinary refund',()=>{
 assert.equal(calculateCancellationRefund({policy,booking,cancelledAt:'2027-03-27T14:00:01Z'}).refundPercent,0);
 assert.equal(calculateCancellationRefund({policy,booking,cancelledAt:'2027-04-03T14:00:00Z'}).refundPercent,0);
});
test('policy rejects any fee, non-refundable option or stay beyond 27 nights',()=>{
 assert.throws(()=>validateCancellationPolicy({...policy,feesPence:{...policy.feesPence,service:1}}));
 assert.throws(()=>validateCancellationPolicy({...policy,nonRefundableOption:true}));
 assert.throws(()=>calculateCancellationRefund({policy,booking:{...booking,nights:28},cancelledAt:'2027-03-20T12:00:00Z'}));
});

test('strict cancellation applies to total holiday price rather than just the 50% deposit',()=>{
 const half={...booking,amountPaidPence:40250,totalPricePence:80500};
 const within24=calculateCancellationRefund({policy,booking:half,cancelledAt:'2027-03-02T12:00:00Z'});
 assert.equal(within24.refundAmountPence,40250);
 const moreThanWeek=calculateCancellationRefund({policy,booking:half,cancelledAt:'2027-03-20T12:00:00Z'});
 assert.equal(moreThanWeek.refundPercent,50);
 assert.equal(moreThanWeek.refundAmountPence,0,'retained booking cancellation amount equals deposit');
 const fullyPaid=calculateCancellationRefund({policy,booking:{...half,amountPaidPence:80500},
  cancelledAt:'2027-03-20T12:00:00Z'});
 assert.equal(fullyPaid.refundAmountPence,40250);
 assert.equal(calculateCancellationRefund({policy,booking:half,cancelledAt:'2027-03-28T12:00:00Z'}).refundAmountPence,0);
 assert.throws(()=>calculateCancellationRefund({policy,
  booking:{...half,totalPricePence:40249},cancelledAt:'2027-03-20T12:00:00Z'}),/total booking price/);
});
