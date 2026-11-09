import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePaymentAndNotify} from './booking-payment-confirmation-followup.mjs';
const id='11111111-1111-4111-8111-111111111111';
const db={send:async()=>({})};
const env={BOOKING_ENVIRONMENT:'staging',MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED:'true',
 BOOKING_CONFIRMATION_DISPATCH_ENABLED:'true',BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
test('confirmed payment delegates to durable outbox and never claims SES delivery',async()=>{
 let calls=0;
 const result=await reconcilePaymentAndNotify({db,bookingId:id,env,
  reconcile:async()=>({bookingId:id,status:'CONFIRMED'}),
  dispatch:async()=>{calls++;return {status:'ACCEPTED_BY_SES_NOT_DELIVERED'};}});
 assert.equal(calls,1);
 assert.deepEqual(result,{bookingId:id,status:'CONFIRMED',guestNotificationSent:false,
  notificationStatus:'ACCEPTED_BY_SES_NOT_DELIVERED'});
});
test('ambiguous email failure does not undo confirmed booking or trigger retry',async()=>{
 let sends=0;
 const result=await reconcilePaymentAndNotify({db,bookingId:id,env,
  reconcile:async()=>({bookingId:id,status:'ALREADY_CONFIRMED'}),
  dispatch:async()=>{sends++;throw Error('SES outcome uncertain');}});
 assert.equal(sends,1);
 assert.equal(result.status,'ALREADY_CONFIRMED');
 assert.equal(result.notificationStatus,'RECONCILIATION_REQUIRED');
 assert.equal(result.guestNotificationSent,false);
});
test('disabled correspondence never invokes outbox',async()=>{
 let sends=0;
 const result=await reconcilePaymentAndNotify({db,bookingId:id,
  env:{...env,BOOKING_CONFIRMATION_DISPATCH_ENABLED:'false'},
  reconcile:async()=>({bookingId:id,status:'CONFIRMED'}),
  dispatch:async()=>{sends++;}});
 assert.equal(sends,0);assert.equal(result.notificationStatus,'DISABLED');
});
test('unverified payment cannot trigger guest notification',async()=>{
 let sends=0;
 await assert.rejects(reconcilePaymentAndNotify({db,bookingId:id,env,
  reconcile:async()=>({bookingId:id,status:'PENDING'}),
  dispatch:async()=>{sends++;}}),/Provider-verified/);
 assert.equal(sends,0);
});
test('production cannot reconcile or dispatch',async()=>{
 let calls=0;
 await assert.rejects(reconcilePaymentAndNotify({db,bookingId:id,
  env:{...env,BOOKING_ENVIRONMENT:'production'},
  reconcile:async()=>{calls++;},dispatch:async()=>{calls++;}}),/disabled/);
 assert.equal(calls,0);
});
