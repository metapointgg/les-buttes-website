import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {dispatchConfirmedGuestEmail} from './booking-confirmation-email-dispatch.mjs';
const id='11111111-1111-4111-8111-111111111111';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const booking={id,source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paidAt:'2026-11-05T08:00:00.000Z',paymentTransactionId:'sumup-transaction-123',
 guestEmail:'verified@example.com',guestName:'Verified Guest',guestTelephone:'+44 1481 000000',guests:2,
 units:['geranium'],start:'2027-08-28',end:'2027-09-04'};
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

test('request dispatch reads authoritative state and sends distinct guest and owner events',async()=>{
 const {dispatchRequestedBookingEmails}=await import('./booking-confirmation-email-dispatch.mjs');
 const messages=[];
 const args={db:{send:async command=>{assert.equal(command.input.ConsistentRead,true);return {Item:{...booking,status:'REQUESTED',reservationStatus:'PENDING_REVIEW'}};}},
  table,bookingId:id,env:{BOOKING_ENVIRONMENT:'staging',BOOKING_REQUEST_DISPATCH_ENABLED:'true',BOOKING_OWNER_EMAIL:'owner@example.com'},
  transport:{send:async()=>{}},send:async({message})=>{messages.push(message);return {status:'ALREADY_CLAIMED'};}};
 await dispatchRequestedBookingEmails(args);
 assert.deepEqual(messages.map(m=>[m.type,m.to]),[['requested','verified@example.com'],['owner_request','owner@example.com']]);
 await assert.rejects(dispatchRequestedBookingEmails({...args,env:{...args.env,BOOKING_ENVIRONMENT:'production'}}),/disabled/);
 await assert.rejects(dispatchRequestedBookingEmails({...args,db:{send:async()=>({Item:booking})}}),/requested booking/);
 assert.equal(messages.length,2);
});

test('lifecycle payment request requires authoritative matching checkout and synthetic simulator identity',async()=>{
 const {dispatchBookingLifecycleEmail}=await import('./booking-confirmation-email-dispatch.mjs');
 const approved={...booking,synthetic:true,guestEmail:'test@example.invalid',status:'APPROVED_AWAITING_PAYMENT',approvedAmountGBP:735,holdExpiresAt:Math.floor(Date.now()/1000)+3600};
 const checkout={bookingId:id,status:'PENDING',currency:'GBP',amountPence:73500,hostedCheckoutUrl:'https://checkout.sumup.com/pay/c-11111111-1111-4111-8111-111111111111'};
 const messages=[];
 const args={db:{send:async command=>({Item:command.input.Key.SK==='META'?approved:checkout})},table,bookingId:id,type:'approval_payment',
  env:{BOOKING_ENVIRONMENT:'staging',BOOKING_LIFECYCLE_DISPATCH_ENABLED:'true',BOOKING_SES_SIMULATOR_ENABLED:'true'},
  transport:{send:async()=>{}},send:async({message})=>{messages.push(message);return {status:'ACCEPTED_BY_SES_NOT_DELIVERED'};}};
 await dispatchBookingLifecycleEmail(args);
 assert.equal(messages[0].to,'success@simulator.amazonses.com');
 assert.match(messages[0].body,/£735.00/);
 checkout.amountPence=1;
 await assert.rejects(dispatchBookingLifecycleEmail(args),/approved checkout/);
 approved.synthetic=false;
 await assert.rejects(dispatchBookingLifecycleEmail(args),/synthetic booking/);
 assert.equal(messages.length,1);
});
