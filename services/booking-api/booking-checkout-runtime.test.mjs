import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutRuntimeEnabled,registerCheckoutWithSandbox} from './booking-checkout-runtime.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 MANAGEMENT_WRITES_ENABLED:'true',MANAGEMENT_CHECKOUT_ENABLED:'true',
 BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
const identity={role:'owner',subject:'staging-owner-1'};
const bookingId='11111111-1111-4111-8111-111111111111';
test('LB-08 checkout registration runtime disabled by default and refuses other tables',async()=>{
 for(const change of [{MANAGEMENT_CHECKOUT_ENABLED:'false'},
  {BOOKING_ENVIRONMENT:'production'},{AWS_REGION:'eu-west-1'},
  {BOOKINGS_TABLE:'les-buttes-lb08-staging-isolated-acceptance'},
  {MANAGEMENT_WRITES_ENABLED:'false'}]){
  const e={...env,...change};
  assert.equal(checkoutRuntimeEnabled(e),false);
  await assert.rejects(registerCheckoutWithSandbox({env:e,db:{send(){}},
   identity,bookingId,ssmFactory:()=>{throw Error('SSM called');}}),/disabled/);
 }
});
test('LB-08 runtime verifies sandbox merchant before constructing checkout client',async()=>{
 const order=[];
 const output=await registerCheckoutWithSandbox({env,db:{send:async()=>({})},
  identity,bookingId,ssmFactory:()=>{
   order.push('ssm');return {destroy:()=>order.push('destroy')};},
  verifyMerchant:async()=>{order.push('merchant');return {sandboxVerified:true,merchantMatched:true};},
  loadCredentials:async()=>{order.push('credentials');
   return {apiKey:'sup_sk_fixture',merchantCode:'MERCHANT1'};},
  clientFactory:options=>{order.push('client');assert.equal(options.enabled,true);
   return {sandbox:true};},
  register:async args=>{order.push('register');
   assert.equal(args.table,env.BOOKINGS_TABLE);
   assert.equal(args.identity,identity);assert.equal(args.bookingId,bookingId);
   assert.deepEqual(args.sumup,{sandbox:true});return {status:'REGISTERED'};}
 });
 assert.equal(output.status,'REGISTERED');
 assert.deepEqual(order,['ssm','merchant','credentials','client','register','destroy']);
});
test('LB-08 runtime refuses unverified merchant and never creates provider client',async()=>{
 let clients=0,destroyed=0;
 await assert.rejects(registerCheckoutWithSandbox({env,db:{send:async()=>({})},
  identity,bookingId,ssmFactory:()=>({destroy(){destroyed++;}}),
  verifyMerchant:async()=>({sandboxVerified:false,merchantMatched:true}),
  clientFactory:()=>{clients++;}}),/Sandbox merchant verification required/);
 assert.equal(clients,0);assert.equal(destroyed,1);
});
test('LB-08 checkout runtime refuses non-owner before SSM access',async()=>{
 await assert.rejects(registerCheckoutWithSandbox({env,db:{send:async()=>({})},
  identity:{role:'viewer'},bookingId,ssmFactory:()=>{throw Error('SSM called');}}),/disabled/);
});
