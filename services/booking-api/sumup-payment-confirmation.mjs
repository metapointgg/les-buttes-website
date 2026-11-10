// LB-08: prepare one conditional DynamoDB transaction; not exposed by HTTP.
// Caller MUST supply independently verified provider evidence and a strongly consistent booking.
import {randomUUID} from 'node:crypto';
import {prepareOwnerTransition} from './booking-admin-transaction-policy.mjs';
import {validateCancellationPolicy} from './cancellation-policy.mjs';
import {guernseyLocalInstant,validateArrivalDeparturePolicy} from './arrival-departure-policy.mjs';
export function preparePaymentConfirmation({booking,registered,evidence,cancellationPolicyRecord,
 arrivalDepartureRecord,
 policyConditionRequired=true,
 nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!booking||!registered||!evidence?.verified||evidence.bookingId!==booking.id||
   evidence.checkoutId!==registered.checkoutId||
   evidence.reference!==registered.reference||
   evidence.amountPence!==registered.amountPence||
   evidence.currency!=='GBP'||!Number.isSafeInteger(nowEpoch)||nowEpoch<0)
  throw Error('Independent payment evidence does not match checkout and booking');
 if(booking.source!=='direct'||booking.GSI1PK!=='BOOKING_REQUESTS'||
   booking.status!=='APPROVED_AWAITING_PAYMENT'||booking.reservationStatus!=='AWAITING_PAYMENT'||
   !Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=nowEpoch||
   Math.round(Number(booking.approvedAmountGBP)*100)!==registered.amountPence)
  throw Error('Booking not eligible for payment confirmation');
 if(typeof evidence.transactionId!=='string'||!/^[A-Za-z0-9_-]{6,128}$/.test(evidence.transactionId))
  throw Error('Verified provider transaction ID required');
 if(!cancellationPolicyRecord||cancellationPolicyRecord.PK!=='CONFIG#cancellation#all'||
   cancellationPolicyRecord.SK!=='CURRENT'||typeof cancellationPolicyRecord.version!=='string'||
   cancellationPolicyRecord.version.length<8)throw Error('Published cancellation policy required');
 validateCancellationPolicy(cancellationPolicyRecord.value);
 if(!arrivalDepartureRecord||arrivalDepartureRecord.PK!=='CONFIG#arrival-departure#all'||
   arrivalDepartureRecord.SK!=='CURRENT'||typeof arrivalDepartureRecord.version!=='string'||
   arrivalDepartureRecord.version.length<8)throw Error('Published arrival and departure policy required');
 validateArrivalDeparturePolicy(arrivalDepartureRecord.value);
 if(arrivalDepartureRecord.value.testOnly===true&&booking.synthetic!==true)
  throw Error('Test arrival and departure policy requires synthetic booking');
 const allocation=prepareOwnerTransition({identity:{role:'owner'},action:'cancel',
  booking:{...booking,status:'CONFIRMED',reservationStatus:'CONFIRMED'},reason:'Payment verification allocation',nowEpoch});
 if(!allocation.allowed)throw Error(allocation.reason);
 if(allocation.slots.length+4>100)throw Error('Confirmation transaction exceeds limit');
 const eventId=randomUUID(),stamp=new Date(nowEpoch*1000).toISOString();
 const nights=(Date.parse(booking.end+'T00:00:00Z')-Date.parse(booking.start+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(nights)||nights<1||nights>27)throw Error('Invalid booking dates');
 const checkInAt=guernseyLocalInstant(booking.start,arrivalDepartureRecord.value.checkInLocalTime);
 const key={PK:'BOOKING#'+booking.id,SK:'META'};
 const amount=registered.amountPence/100;
 const items=[
  {Update:{Key:key,UpdateExpression:'SET #status = :confirmed, reservationStatus = :confirmed, paidAt = :stamp, confirmedAt = :stamp, paidAmountPence = :pence, paymentTransactionId = :tx, updatedAt = :stamp, cancellationPolicyVersion = :policyVersion, cancellationPolicyId = :policyId, arrivalDepartureVersion = :arrivalVersion, checkInAt = :checkInAt, nights = :nights REMOVE expiresAt, holdExpiresAt',
   ConditionExpression:'#status = :approved AND reservationStatus = :awaiting AND id = :id AND #source = :direct AND approvedAmountGBP = :amount AND holdExpiresAt = :expiry AND holdExpiresAt > :now AND #units = :units AND #start = :start AND #end = :end',
   ExpressionAttributeNames:{'#status':'status','#source':'source','#units':'units','#start':'start','#end':'end'},
   ExpressionAttributeValues:{':confirmed':'CONFIRMED',':approved':'APPROVED_AWAITING_PAYMENT',':awaiting':'AWAITING_PAYMENT',
    ':id':booking.id,':direct':'direct',':amount':amount,':expiry':booking.holdExpiresAt,':now':nowEpoch,
    ':units':booking.units,':start':booking.start,':end':booking.end,':stamp':stamp,':tx':evidence.transactionId,
    ':policyVersion':cancellationPolicyRecord.version,':policyId':cancellationPolicyRecord.value.policyId,
    ':arrivalVersion':arrivalDepartureRecord.version,':checkInAt':checkInAt,':nights':nights,
    ':pence':registered.amountPence}}},
  {ConditionCheck:{Key:{PK:'BOOKING#'+booking.id,SK:'PAYMENT#CHECKOUT'},
   ConditionExpression:'checkoutId = :checkout AND #reference = :ref AND amountPence = :pence AND currency = :gbp',
   ExpressionAttributeNames:{'#reference':'reference'},
   ExpressionAttributeValues:{':checkout':registered.checkoutId,':ref':registered.reference,
    ':pence':registered.amountPence,':gbp':'GBP'}}},
 ];
 if(policyConditionRequired)items.push({ConditionCheck:{Key:{PK:'CONFIG#cancellation#all',SK:'CURRENT'},
  ConditionExpression:'#version = :version AND #value = :value',
  ExpressionAttributeNames:{'#version':'version','#value':'value'},
  ExpressionAttributeValues:{':version':cancellationPolicyRecord.version,':value':cancellationPolicyRecord.value}}});
 if(policyConditionRequired)items.push({ConditionCheck:{Key:{PK:'CONFIG#arrival-departure#all',SK:'CURRENT'},
  ConditionExpression:'#version = :version AND #value = :value',
  ExpressionAttributeNames:{'#version':'version','#value':'value'},
  ExpressionAttributeValues:{':version':arrivalDepartureRecord.version,':value':arrivalDepartureRecord.value}}});
 for(const slot of allocation.slots)items.push({Update:{Key:slot,
  UpdateExpression:'REMOVE expiresAt',
  ConditionExpression:'id = :id AND expiresAt = :expiry AND expiresAt > :now',
  ExpressionAttributeValues:{':id':booking.id,':expiry':booking.holdExpiresAt,':now':nowEpoch}}});
 items.push({Put:{Item:{PK:'PAYMENT_TRANSACTION#'+evidence.transactionId,SK:'CONFIRMATION',
  bookingId:booking.id,checkoutId:registered.checkoutId,amountPence:registered.amountPence,currency:'GBP',recordedAt:stamp},
  ConditionExpression:'attribute_not_exists(PK)'}});
 items.push({Put:{Item:{PK:'BOOKING#'+booking.id,SK:'AUDIT#'+stamp+'#'+eventId,
  id:eventId,bookingId:booking.id,action:'payment_confirmed',from:booking.status,to:'CONFIRMED',
  provider:'sumup',checkoutId:registered.checkoutId,transactionId:evidence.transactionId,recordedAt:stamp},
  ConditionExpression:'attribute_not_exists(PK)'}});
 return {items,eventId,affectedNights:allocation.slots.length};
}
