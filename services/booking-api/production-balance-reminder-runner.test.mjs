import test from 'node:test';
import assert from 'node:assert/strict';
import {processProductionBalance} from './production-balance-reminder-runner.mjs';
const id='11111111-1111-4111-8111-111111111111';
const booking={id,source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paymentStatus:'PARTIALLY_PAID',balanceDuePence:40250,
 paymentSchedule:{balancePence:40250,dueDate:'2027-04-24'},start:'2027-05-08'};
test('3 month balance reminder dispatches without creating short-lived provider session',async()=>{
 let providerCalls=0;const sent=[];
 const db={send:async()=>({})};
 const result=await processProductionBalance({db,table:'test',booking,today:'2027-02-08',
  ssmFactory:()=>{providerCalls++;throw Error('SumUp must not be contacted for an email reminder');},
  clientFactory:()=>{providerCalls++;throw Error('Provider unavailable');},
  transportFactory:()=>({send:()=>{}}),
  dispatch:async args=>{sent.push({type:args.type,reminderStage:args.reminderStage});
   return {status:'ACCEPTED_BY_SES_NOT_DELIVERED'};}});
 assert.equal(result.status,'PENDING');
 assert.equal(result.reminderStage,3);
 assert.deepEqual(sent,[{type:'balance_reminder',reminderStage:3}]);
 assert.equal(providerCalls,0);
});
test('fully paid and cancelled bookings never generate new reminders',async()=>{
 let queried=0;
 const db={send:async()=>{queried++;return {};}};
 for(const changed of [{paymentStatus:'PAID_IN_FULL'},{status:'CANCELLED'}])
  assert.equal((await processProductionBalance({db,table:'test',booking:{...booking,...changed}})).status,'SKIPPED');
 assert.equal(queried,0);
});

test('owner-only £2 reminder schedule is accelerated in minutes and preserves sequence after missed runs',async()=>{
 const t0='2026-11-14T21:55:32.000Z';
 const bookingTest={...booking,guestEmail:'mike@un1ty.gg',source:'direct',
   acceleratedReminderTest:true,approvedAmountGBP:2,confirmedAt:t0,
   balanceDuePence:100,paymentSchedule:{...booking.paymentSchedule,
    policyMode:'DEPOSIT_50',depositPercent:50,totalPence:200,
    dueNowPence:100,balancePence:100,dueDate:'2027-03-06'}};
 const sentClaims=new Set();
 const dispatched=[];
 const db={send:async command=>{
  const sk=command.input?.Key?.SK;
  if(sk==='PAYMENT#BALANCE_CHECKOUT')return {};
  if(sk?.startsWith('EMAIL#balance_reminder#')){
    return {Item:sentClaims.has(sk)?{state:'ACCEPTED_BY_SES_NOT_DELIVERED'}:undefined};
  }
  throw Error('Unexpected data access: '+sk);
 }};
 const dispatch=async x=>{
  dispatched.push(x.reminderStage);
  sentClaims.add('EMAIL#balance_reminder#balance_reminder_'+x.reminderStage+'_v1');
  return {status:'ACCEPTED_BY_SES_NOT_DELIVERED'};
 };
 const args={db,table:'test',booking:bookingTest,dispatch,
   transportFactory:()=>({send:()=>{throw Error('Not a real email');}})};
 const tick=async mins=>processProductionBalance({...args,now:new Date(Date.parse(t0)+mins*60000)});
 assert.equal((await tick(1)).reminderStage,null);
 assert.equal((await tick(2)).reminderStage,3);
 assert.equal((await tick(9)).reminderStage,2);
 assert.equal((await tick(11)).reminderStage,1);
 assert.equal((await tick(13)).reminderStage,0);
 assert.equal((await tick(15)).reminderStage,null);
 assert.deepEqual(dispatched,[3,2,1,0]);
 assert.equal((await processProductionBalance({...args,
  booking:{...bookingTest,paymentStatus:'PAID_IN_FULL',balanceDuePence:0},
  now:new Date(Date.parse(t0)+17*60000)})).status,'SKIPPED');
});
test('accelerated schedule cannot be enabled for non-owner guest, incorrect amount or missing marker',async()=>{
 const {acceleratedTestStagesDue}=await import('./production-balance-reminders.mjs');
 const b={...booking,source:'direct',guestEmail:'mike@un1ty.gg',acceleratedReminderTest:true,
  approvedAmountGBP:2,confirmedAt:'2026-11-14T21:55:32Z',balanceDuePence:100,
  paymentSchedule:{...booking.paymentSchedule,policyMode:'DEPOSIT_50',depositPercent:50,
    totalPence:200,dueNowPence:100,balancePence:100}};
 for(const changed of [{guestEmail:'guest@example.com'},{approvedAmountGBP:735},
   {acceleratedReminderTest:false},{paymentSchedule:{...b.paymentSchedule,totalPence:73500}}]){
  assert.deepEqual(acceleratedTestStagesDue({booking:{...b,...changed},
   now:new Date('2026-11-14T23:00:00Z')}),[]);
 }
});
