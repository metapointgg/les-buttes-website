// Date-only reminder selection. Only the latest milestone can be due on a
// scheduler run; a permanent per-stage SES outbox claim prevents duplicate mail.
import {monthBefore} from './booking-payment-policy.mjs';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export function currentBalanceReminderStage({booking,today=new Date().toISOString().slice(0,10)}={}){
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
