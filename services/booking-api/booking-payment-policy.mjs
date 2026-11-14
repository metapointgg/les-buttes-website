// Pure, currency-safe payment terms. Terms are snapshotted at booking approval;
// changing the global setting never retrospectively changes an existing booking.
const DAY=86400000;
const GUERNSEY='Europe/Guernsey';
export function guernseyBookingToday(instant=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:GUERNSEY,
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
 const values=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return values.year+'-'+values.month+'-'+values.day;
}
const formatDate=ms=>new Date(ms).toISOString().slice(0,10);
const parseDate=s=>{
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Invalid arrival date');
 const ms=Date.parse(s+'T00:00:00Z');
 if(!Number.isFinite(ms)||formatDate(ms)!==s)throw Error('Invalid arrival date');
 return ms;
};
export const DEFAULT_PAYMENT_POLICY=Object.freeze({
 depositPercent:100,balanceDueDays:14,fullPaymentWithinDays:30,
 reminderMonths:[3,2,1]
});
export function validatePaymentPolicy(policy){
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||
    ![50,100].includes(policy.depositPercent)||
    policy.balanceDueDays!==14||policy.fullPaymentWithinDays!==30||
    !Array.isArray(policy.reminderMonths)||
    JSON.stringify(policy.reminderMonths)!=='[3,2,1]')
  throw Error('Invalid global payment policy: use 50% or 100%, 14-day balance deadline and 3/2/1-month reminders');
 return true;
}
export function monthBefore(iso,months){
 if(!Number.isSafeInteger(months)||months<1||months>12)throw Error('Invalid reminder offset');
 const original=parseDate(iso),d=new Date(original);
 const first=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-months,1);
 const firstDate=new Date(first);
 const daysInMonth=new Date(Date.UTC(firstDate.getUTCFullYear(),firstDate.getUTCMonth()+1,0)).getUTCDate();
 return formatDate(Date.UTC(firstDate.getUTCFullYear(),firstDate.getUTCMonth(),Math.min(d.getUTCDate(),daysInMonth)));
}
export function calculatePaymentSchedule({totalPence,arrival,asOf=guernseyBookingToday(),
 policy=DEFAULT_PAYMENT_POLICY}={}){
 validatePaymentPolicy(policy);
 if(!Number.isSafeInteger(totalPence)||totalPence<1||totalPence>100000000)throw Error('Invalid booking total in pence');
 const arrivalMs=parseDate(arrival),asOfMs=parseDate(asOf);
 const daysUntil=Math.floor((arrivalMs-asOfMs)/DAY);
 if(daysUntil<0)throw Error('Arrival has passed');
 const fullAtBooking=policy.depositPercent===100||daysUntil<=policy.fullPaymentWithinDays;
 // Round the first instalment upward to the penny; the balance is exact.
 const dueNowPence=fullAtBooking?totalPence:Math.ceil(totalPence*policy.depositPercent/100);
 const balancePence=totalPence-dueNowPence;
 const dueDate=formatDate(arrivalMs-policy.balanceDueDays*DAY);
 return {totalPence,dueNowPence,balancePence,
  dueDate:balancePence?dueDate:null,depositPercent:fullAtBooking?100:policy.depositPercent,
  fullPaymentWithinDays:policy.fullPaymentWithinDays,
  reminders:balancePence?policy.reminderMonths.map(months=>({months,date:monthBefore(arrival,months)})):[],
  policyMode:policy.depositPercent===50?'DEPOSIT_50':'PAY_FULL',
  asOf};
}
export function firstName(name){
 const clean=typeof name==='string'?name.trim():'';
 if(!clean||clean.length>120||/[\r\n<>\x00-\x1f]/.test(clean))throw Error('Invalid guest first name');
 return clean.split(/\s+/)[0];
}
export const money=pence=>'£'+(pence/100).toFixed(2);
