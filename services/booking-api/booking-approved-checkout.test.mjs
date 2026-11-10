import test from 'node:test';import assert from 'node:assert/strict';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {registerApprovedBookingCheckout} from './booking-approved-checkout.mjs';
const id='11111111-1111-4111-8111-111111111111';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',
 status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT',
 approvedAmountGBP:250,holdExpiresAt:200};
const identity={role:'owner',subject:'owner-1'};
test('LB-08 checkout registration takes authoritative price and never trusts client price',async()=>{
 const prior=process.env.BOOKING_ENVIRONMENT;process.env.BOOKING_ENVIRONMENT='staging';
 try{
  let reads=0,calls=0;
  const db={send:async cmd=>{reads++;assert.ok(cmd instanceof GetCommand);
   assert.equal(cmd.input.ConsistentRead,true);return {Item:booking};}};
  const result=await registerApprovedBookingCheckout({db,table,bookingId:id,identity,sumup:{},
   nowEpoch:100,orchestrate:async args=>{
    calls++;assert.equal(args.amountPence,25000);assert.equal(args.actor,'owner-1');
    return {status:'REGISTERED',record:{bookingId:id,amountPence:25000,
     currency:'GBP',status:'PENDING',checkoutId:'checkout-12345'}};}});
  assert.deepEqual(result,{status:'REGISTERED',bookingId:id,checkoutId:'checkout-12345',
   amountPence:25000,currency:'GBP',guestNotificationSent:false});
  assert.equal(reads,1);assert.equal(calls,1);
 }finally{if(prior===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=prior;}
});
test('LB-08 refuses production, fake table, non-owner and expired booking before checkout creation',async()=>{
 const prior=process.env.BOOKING_ENVIRONMENT;process.env.BOOKING_ENVIRONMENT='staging';
 try{
  let created=0;
  for(const change of [{table:'les-buttes-lb08-staging-isolated-acceptance'},
   {identity:{role:'viewer',subject:'owner-1'}},
   {record:{...booking,holdExpiresAt:100}},
   {record:{...booking,status:'CONFIRMED'}},
   {record:{...booking,approvedAmountGBP:undefined}}]){
   const db={send:async()=>({Item:change.record??booking})};
   await assert.rejects(registerApprovedBookingCheckout({db,
    table:change.table??table,identity:change.identity??identity,
    bookingId:id,sumup:{},nowEpoch:100,
    orchestrate:async()=>{created++;return {};}}));
  }
  process.env.BOOKING_ENVIRONMENT='production';
  await assert.rejects(registerApprovedBookingCheckout({db:{send:async()=>({Item:booking})},
   table,bookingId:id,identity,sumup:{},orchestrate:async()=>{created++;}}),/unavailable/);
  assert.equal(created,0);
 }finally{if(prior===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=prior;}
});
test('LB-08 refuses unregistered provider checkout and does not claim success',async()=>{
 const prior=process.env.BOOKING_ENVIRONMENT;process.env.BOOKING_ENVIRONMENT='staging';
 try{
  await assert.rejects(registerApprovedBookingCheckout({db:{send:async()=>({Item:booking})},
   table,bookingId:id,identity,sumup:{},nowEpoch:100,
   orchestrate:async()=>({status:'REGISTERED',record:{bookingId:id,amountPence:99,
    currency:'GBP',status:'PENDING'}})}),/not verified/);
 }finally{if(prior===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=prior;}
});
test('production checkout core requires both live approval gates and production table',async()=>{
 const productionTable='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
 const env={BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:productionTable,
  PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true'};
 let calls=0;
 const result=await registerApprovedBookingCheckout({db:{send:async()=>({Item:booking})},
  table:productionTable,bookingId:id,identity,sumup:{},nowEpoch:100,env,
  orchestrate:async args=>(calls++,{status:'REGISTERED',record:{bookingId:id,
   amountPence:args.amountPence,currency:'GBP',status:'PENDING',checkoutId:'checkout-live-123'}})});
 assert.equal(result.checkoutId,'checkout-live-123');assert.equal(calls,1);
 for(const patch of [{LIVE_PAYMENTS_APPROVED:'false'},{PAYMENTS_ENABLED:'false'},
  {BOOKINGS_TABLE:table}])await assert.rejects(registerApprovedBookingCheckout({
   db:{send:async()=>({Item:booking})},table:patch.BOOKINGS_TABLE??productionTable,
   bookingId:id,identity,sumup:{},nowEpoch:100,env:{...env,...patch},
   orchestrate:async()=>{calls++;}}),/unavailable/);
 assert.equal(calls,1);
});
