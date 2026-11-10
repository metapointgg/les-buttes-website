// Pure policy assessment. Provider refund execution is deliberately separate.
import {calculateCancellationRefund,validateCancellationPolicy} from './cancellation-policy.mjs';

export function assessBookingCancellation({booking,policyRecord,cancelledAt}={}){
 if(!booking||booking.source!=='direct'||booking.status!=='CONFIRMED'||
   booking.reservationStatus!=='CONFIRMED'||typeof booking.cancellationPolicyVersion!=='string'||
   typeof booking.cancellationPolicyId!=='string'||typeof booking.paidAt!=='string'||
   typeof booking.confirmedAt!=='string'||typeof booking.arrivalDepartureVersion!=='string'||
   !Number.isSafeInteger(booking.paidAmountPence)||booking.paidAmountPence<1)
  throw Error('Confirmed policy-bound paid booking required');
 if(!policyRecord||policyRecord.PK!=='CONFIG#cancellation#all'||
   policyRecord.SK!=='VERSION#'+booking.cancellationPolicyVersion||
   policyRecord.version!==booking.cancellationPolicyVersion)
  throw Error('Immutable cancellation policy version required');
 validateCancellationPolicy(policyRecord.value);
 if(policyRecord.value.policyId!==booking.cancellationPolicyId)
  throw Error('Cancellation policy identity mismatch');
 const nights=(Date.parse(booking.end+'T00:00:00Z')-Date.parse(booking.start+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(nights)||nights<1)throw Error('Invalid booking dates');
 const result=calculateCancellationRefund({policy:policyRecord.value,booking:{
  amountPaidPence:booking.paidAmountPence,nights,confirmedAt:booking.confirmedAt,
  checkInAt:booking.checkInAt
 },cancelledAt});
 return {...result,policyVersion:policyRecord.version,paymentTransactionId:booking.paymentTransactionId};
}
