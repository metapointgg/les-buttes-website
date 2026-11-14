import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePaymentSchedule,validatePaymentPolicy,monthBefore,firstName,guernseyBookingToday} from './booking-payment-policy.mjs';
const half={depositPercent:50,balanceDueDays:14,fullPaymentWithinDays:30,reminderMonths:[3,2,1]};
test('global full payment remains current default',()=>{
 assert.deepEqual(calculatePaymentSchedule({totalPence:80500,arrival:'2027-05-08',asOf:'2026-11-14'}).dueNowPence,80500);
});
test('50% deposit before one-month threshold, exactly balanced to the penny',()=>{
 const v=calculatePaymentSchedule({totalPence:80501,arrival:'2027-05-08',asOf:'2026-11-14',policy:half});
 assert.deepEqual([v.dueNowPence,v.balancePence,v.dueDate],[40251,40250,'2027-04-24']);
 assert.deepEqual(v.reminders,[{months:3,date:'2027-02-08'},{months:2,date:'2027-03-08'},{months:1,date:'2027-04-08'}]);
});
test('arrival at 30 days or closer charges full amount, never a deposit',()=>{
 for(const date of ['2027-04-08','2027-04-09','2027-05-07']){
  const v=calculatePaymentSchedule({totalPence:80500,arrival:'2027-05-08',asOf:date,policy:half});
  assert.deepEqual([v.dueNowPence,v.balancePence,v.dueDate],[80500,0,null]);
 }
 const v=calculatePaymentSchedule({totalPence:80500,arrival:'2027-05-08',asOf:'2027-04-07',policy:half});
 assert.equal(v.balancePence,40250);
});
test('calendar-month reminder dates clamp 31st safely',()=>{
 assert.equal(monthBefore('2027-05-31',3),'2027-02-28');
 assert.equal(monthBefore('2028-05-31',3),'2028-02-29');
});
test('payment policy rejects unsupported values',()=>{
 for(const v of [{...half,depositPercent:25},{...half,balanceDueDays:7},{...half,reminderMonths:[1,2,3]},{}])
  assert.throws(()=>validatePaymentPolicy(v));
});
test('first name uses name provided at booking and rejects injected line breaks',()=>{
 assert.equal(firstName('  Dave Example  '),'Dave');
 assert.throws(()=>firstName('Dave\nBCC: example@example.com'));
});

test('30-day payment policy respects Guernsey civil date during summer time',()=>{
 assert.equal(guernseyBookingToday(new Date('2027-06-01T23:30:00Z')),'2027-06-02');
 assert.equal(guernseyBookingToday(new Date('2027-01-01T23:30:00Z')),'2027-01-01');
});
