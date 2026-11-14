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
