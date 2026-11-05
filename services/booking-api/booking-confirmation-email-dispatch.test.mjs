import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {dispatchConfirmedGuestEmail} from './booking-confirmation-email-dispatch.mjs';
const id='11111111-1111-4111-8111-111111111111';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const booking={id,source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paidAt:'2026-11-05T08:00:00.000Z',paymentTransactionId:'sumup-transaction-123',
 guestEmail:'verified@example.com',units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
const env={BOOKING_ENVIRONMENT:'staging',BOOKING_CONFIRMATION_DISPATCH_ENABLED:'true'};
test('dispatch reads authoritative confirmed record and delegates to durable outbox',async()=>{
 let reads=0,sends=0;
 const db={send:async command=>{assert.ok(command instanceof GetCommand);
  assert.equal(command.input.ConsistentRead,true);
  assert.equal(command.input.TableName,table);reads++;return {Item:booking};}};
 const result=await dispatchConfirmedGuestEmail({db,table,bookingId:id,env,
  transport:{send:async()=>{throw Error('transport must be called by outbox');}},
  send:async ({message})=>{sends++;assert.equal(message.to,'verified@example.com');
   assert.equal(message.type,'confirmed');return {status:'ALREADY_CLAIMED'};}});
 assert.equal(result.status,'ALREADY_CLAIMED');
 assert.equal(reads,1);assert.equal(sends,1);
});
test('dispatch refuses pending bookings and does not claim or send',async()=>{
 let sends=0;
 await assert.rejects(dispatchConfirmedGuestEmail({db:{send:async()=>({Item:{
  ...booking,status:'APPROVED_AWAITING_PAYMENT'}})},table,bookingId:id,env,
  transport:{send:async()=>{}},send:async()=>{sends++;}}),/confirmed booking/);
 assert.equal(sends,0);
});
test('dispatch disabled in production or without explicit feature flag before reading',async()=>{
 let reads=0;
 const db={send:async()=>{reads++;return {Item:booking};}};
 for(const overrides of [{BOOKING_ENVIRONMENT:'production'},{
  BOOKING_CONFIRMATION_DISPATCH_ENABLED:'false'}])
  await assert.rejects(dispatchConfirmedGuestEmail({db,table,bookingId:id,
   env:{...env,...overrides},transport:{send:async()=>{}}}),/disabled/);
 assert.equal(reads,0);
});
