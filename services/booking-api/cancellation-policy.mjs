const DAY=86400000;
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const STRICT_SHORT_STAY_POLICY_ID='DIRECT_AIRBNB_STRICT_SHORT_STAY_V1';
export const APPROVED_STRICT_SHORT_STAY_POLICY=Object.freeze({
 policyId:STRICT_SHORT_STAY_POLICY_ID,appliesToMaxNights:27,timezone:'Europe/Guernsey',
 initialFullRefundHours:24,initialFullRefundMinimumLeadDays:7,
 tiers:Object.freeze([Object.freeze({daysBeforeArrival:7,refundPercent:50}),
  Object.freeze({daysBeforeArrival:0,refundPercent:0})]),
 afterCheckInRefundPercent:0,
 feesPence:Object.freeze({booking:0,administration:0,service:0,cancellation:0}),
 nonRefundableOption:false,rounding:'HALF_UP_TO_PENNY',
 sourceUrl:'https://www.airbnb.com/help/article/475',verifiedOn:'2026-11-09'
});

export function validateCancellationPolicy(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    value.policyId!==STRICT_SHORT_STAY_POLICY_ID||value.appliesToMaxNights!==27||
    value.timezone!=='Europe/Guernsey'||value.initialFullRefundHours!==24||
    value.initialFullRefundMinimumLeadDays!==7||value.afterCheckInRefundPercent!==0||
    value.nonRefundableOption!==false||value.rounding!=='HALF_UP_TO_PENNY'||
    value.sourceUrl!=='https://www.airbnb.com/help/article/475'||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedOn??''))throw Error('Invalid strict short-stay cancellation policy');
 const fees=value.feesPence;
 if(!fees||Object.keys(fees).sort().join(',')!=='administration,booking,cancellation,service'||
    Object.values(fees).some(amount=>amount!==0))throw Error('Direct cancellation fees must be zero');
 if(!Array.isArray(value.tiers)||value.tiers.length!==2||
    value.tiers[0]?.daysBeforeArrival!==7||value.tiers[0]?.refundPercent!==50||
    value.tiers[1]?.daysBeforeArrival!==0||value.tiers[1]?.refundPercent!==0)
  throw Error('Invalid strict refund tiers');
 return true;
}

const instant=(value,name)=>{
 if(typeof value!=='string'||!INSTANT.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid '+name);
 return Date.parse(value);
};

export function calculateCancellationRefund({policy,booking,cancelledAt}={}){
 validateCancellationPolicy(policy);
 if(!booking||!Number.isSafeInteger(booking.amountPaidPence)||booking.amountPaidPence<1||
    !Number.isInteger(booking.nights)||booking.nights<1||booking.nights>policy.appliesToMaxNights)
  throw Error('Invalid paid short-stay booking');
 const confirmed=instant(booking.confirmedAt,'confirmation time');
 const checkIn=instant(booking.checkInAt,'local check-in time');
 const cancelled=instant(cancelledAt,'cancellation time');
 if(confirmed>=checkIn||cancelled<confirmed)throw Error('Invalid cancellation timeline');
 const initialWindowEligible=checkIn-confirmed>=policy.initialFullRefundMinimumLeadDays*DAY;
 let refundPercent,reason;
 if(cancelled<checkIn&&initialWindowEligible&&cancelled-confirmed<=policy.initialFullRefundHours*3600000){
  refundPercent=100;reason='WITHIN_24_HOURS_AND_CONFIRMED_AT_LEAST_7_DAYS_BEFORE_CHECK_IN';
 }else if(cancelled<checkIn&&checkIn-cancelled>=policy.tiers[0].daysBeforeArrival*DAY){
  refundPercent=policy.tiers[0].refundPercent;reason='AT_LEAST_7_DAYS_BEFORE_CHECK_IN';
 }else{
  refundPercent=policy.afterCheckInRefundPercent;reason=cancelled>=checkIn?'AT_OR_AFTER_CHECK_IN':'LESS_THAN_7_DAYS_BEFORE_CHECK_IN';
 }
 const refundAmountPence=Math.round(booking.amountPaidPence*refundPercent/100);
 return {policyId:policy.policyId,refundPercent,refundAmountPence,feePence:0,reason,
  cancellationReceivedAt:cancelledAt,checkInAt:booking.checkInAt};
}
