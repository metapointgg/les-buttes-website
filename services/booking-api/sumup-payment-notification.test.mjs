import test from 'node:test';
import assert from 'node:assert/strict';
import {processPaymentNotification,processSignedInternalPaymentTrigger} from './sumup-payment-notification.mjs';
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

test('signed internal trigger dispatches only after authentication',async()=>{
 const {createHmac}=await import('node:crypto');
 const secret='a-secure-internal-only-32-character-secret';
 const body=JSON.stringify({bookingId,issuedAt:1800000000});
 const signature=createHmac('sha256',secret).update(body).digest('hex');
 let calls=0;
 const reconcile=async input=>{calls++;assert.deepEqual(input,{bookingId});return {status:'CONFIRMED'};};
 const claims=[];
 const db={send:async command=>{claims.push(command);return {};}};
 const args={body,signature,secret,reconcile,db,table:'bookings-staging',nowEpoch:1800000000,enabled:true};
 assert.equal((await processSignedInternalPaymentTrigger(args)).status,'CONFIRMED');
 assert.equal(calls,1);
 assert.equal(claims.length,1);
 await assert.rejects(processSignedInternalPaymentTrigger({...args,signature:'0'.repeat(64)}),/Unauthorised/);
 assert.equal(calls,1);
});

test('duplicate internal signed trigger does not dispatch reconciliation twice',async()=>{
 const {createHmac}=await import('node:crypto');
 const secret='a-secure-internal-only-32-character-secret';
 const body=JSON.stringify({bookingId,issuedAt:1800000000});
 const signature=createHmac('sha256',secret).update(body).digest('hex');
 let claimed=false,calls=0;
 const db={send:async()=>{if(claimed)throw Error('ConditionalCheckFailedException');claimed=true;}};
 const args={body,signature,secret,db,table:'bookings-staging',nowEpoch:1800000000,
  enabled:true,reconcile:async()=>{calls++;return {status:'CONFIRMED'};}};
 await processSignedInternalPaymentTrigger(args);
 await assert.rejects(processSignedInternalPaymentTrigger(args),/ConditionalCheckFailedException/);
 assert.equal(calls,1);
});
test('replay storage missing prevents notification dispatch',async()=>{
 const {createHmac}=await import('node:crypto');
 const secret='a-secure-internal-only-32-character-secret';
 const body=JSON.stringify({bookingId,issuedAt:1800000000});
 const signature=createHmac('sha256',secret).update(body).digest('hex');
 let calls=0;
 await assert.rejects(processSignedInternalPaymentTrigger({body,signature,secret,
  reconcile:async()=>{calls++;},nowEpoch:1800000000,enabled:true}),/replay protection unavailable/);
 assert.equal(calls,0);
});
