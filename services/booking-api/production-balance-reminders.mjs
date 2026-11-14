// Date-only reminder selection. Only the latest milestone can be due on a
// scheduler run; a permanent per-stage SES outbox claim prevents duplicate mail.
import {monthBefore,guernseyBookingToday} from './booking-payment-policy.mjs';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export function currentBalanceReminderStage({booking,today=guernseyBookingToday()}={}){
 if(!DATE.test(today??'')||!booking||booking.status!=='CONFIRMED'||
   booking.reservationStatus!=='CONFIRMED'||booking.paymentStatus!=='PARTIALLY_PAID'||
   !Number.isSafeInteger(booking.balanceDuePence)||booking.balanceDuePence<1||
   !DATE.test(booking.start??'')||!DATE.test(booking.paymentSchedule?.dueDate??'')||
   booking.balanceDuePence!==booking.paymentSchedule.balancePence)
  return null;
 // Avoid reminders once the guest has arrived. Late balances remain visible
 // as overdue in the owner report; never charge automatically.
 if(today>=booking.start)return null;
 const date=booking.start;
 const candidates=[
  {stage:3,date:monthBefore(date,3)},
  {stage:2,date:monthBefore(date,2)},
  {stage:1,date:monthBefore(date,1)},
  {stage:0,date:booking.paymentSchedule.dueDate}
 ];
 let current=null;
 for(const candidate of candidates)if(candidate.date<=today)current=candidate.stage;
 return current;
}

/**
 * Short owner-only acceptance schedule. These do not replace the contractual
 * 3/2/1-month and 14-day payment dates; no real guest receives accelerated mail.
 * The existing two-minute EventBridge rule runs this sequence. Missing runs are
 * recovered one stage per invocation by checking durable SES outbox claims.
 */
const ACCELERATED_TEST_STAGES=Object.freeze([
 {stage:3,minutes:2},{stage:2,minutes:4},
 {stage:1,minutes:6},{stage:0,minutes:8}
]);
export function isAcceleratedReminderTest(booking){
 return booking?.acceleratedReminderTest===true &&
   booking?.source==='direct' && booking?.synthetic!==true &&
   String(booking?.guestEmail??'').trim().toLowerCase()==='mike@un1ty.gg' &&
   booking?.approvedAmountGBP===2 &&
   booking?.paymentSchedule?.policyMode==='DEPOSIT_50' &&
   booking?.paymentSchedule?.depositPercent===50 &&
   booking?.paymentSchedule?.totalPence===200 &&
   booking?.paymentSchedule?.dueNowPence===100 &&
   booking?.paymentSchedule?.balancePence===100;
}
export function acceleratedTestStagesDue({booking,now=new Date()}={}){
 if(!isAcceleratedReminderTest(booking) ||
    booking.status!=='CONFIRMED' ||
    booking.reservationStatus!=='CONFIRMED' ||
    booking.paymentStatus!=='PARTIALLY_PAID' ||
    booking.balanceDuePence!==100 ||
    typeof booking.confirmedAt!=='string')return [];
 const confirmedAt=Date.parse(booking.confirmedAt);
 const instant=now instanceof Date?now.getTime():NaN;
 if(!Number.isFinite(confirmedAt)||!Number.isFinite(instant)||instant<confirmedAt)return [];
 return ACCELERATED_TEST_STAGES
   .filter(x=>instant-confirmedAt>=x.minutes*60000).map(x=>x.stage);
}
