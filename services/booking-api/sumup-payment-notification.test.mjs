import test from 'node:test';
import assert from 'node:assert/strict';
import {processPaymentNotification} from './sumup-payment-notification.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
test('disabled notification handler never invokes reconciliation',async()=>{
 let calls=0;
 await assert.rejects(processPaymentNotification({notification:{bookingId},
  reconcile:async()=>{calls++;},enabled:false}),/disabled/);
 assert.equal(calls,0);
});
test('valid internal trigger passes only the booking reference to independent reconciler',async()=>{
 let calls=0;
 const result=await processPaymentNotification({notification:{bookingId},enabled:true,
  reconcile:async input=>{calls++;assert.deepEqual(input,{bookingId});return {status:'CONFIRMED'};}});
 assert.equal(result.status,'CONFIRMED');assert.equal(calls,1);
});
test('forged paid status or amount is rejected without a reconciliation call',async()=>{
 let calls=0;
 const reconcile=async()=>{calls++;};
 for(const assertion of [{bookingId,status:'PAID'},{bookingId,amount:1630},
  {bookingId,transactionId:'tx_fake'},{bookingId,verified:true},{bookingId,checkoutId:'checkout_fake'}]){
  await assert.rejects(processPaymentNotification({notification:assertion,reconcile,enabled:true}),
   /only a booking reference/);
 }
 assert.equal(calls,0);
});
test('invalid booking references fail closed',async()=>{
 await assert.rejects(processPaymentNotification({notification:{bookingId:'bad'},
  reconcile:async()=>{},enabled:true}),/Invalid notification/);
});
