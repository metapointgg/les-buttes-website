import test from 'node:test';
import assert from 'node:assert/strict';
import {runIsolatedBookingAcceptance,ISOLATED_TABLE} from './lb08-isolated-booking-acceptance.mjs';
const safe={AWS_REGION:'eu-west-2',BOOKING_ENVIRONMENT:'staging',
 BOOKINGS_TABLE:ISOLATED_TABLE,LB08_ISOLATED_BOOKING_ACCEPTANCE:'yes'};
test('LB-08 isolated confirmation refuses any shared booking table or production environment',async()=>{
 for(const patch of [{BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'},
  {BOOKING_ENVIRONMENT:'production'},{AWS_REGION:'eu-west-1'},
  {LB08_ISOLATED_BOOKING_ACCEPTANCE:'no'}]){
  await assert.rejects(runIsolatedBookingAcceptance({env:{...safe,...patch},
   clientFactory:()=>{throw Error('AWS must not be contacted');}}),
   /explicit operator authorisation required/);
 }
});
test('LB-08 refuses unexpected AWS table identity before seeding',async()=>{
 let calls=0;
 await assert.rejects(runIsolatedBookingAcceptance({env:safe,
  clientFactory:()=>({send:async command=>{calls++;
   return {Table:{TableName:ISOLATED_TABLE,TableStatus:'ACTIVE',
    TableArn:'arn:aws:dynamodb:eu-west-2:000000000000:table/'+ISOLATED_TABLE}};}})}),
  /identity not verified/);
 assert.equal(calls,1);
});
