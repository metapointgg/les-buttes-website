import test from 'node:test';import assert from 'node:assert/strict';
import {createAndRegisterCheckout,checkoutReference} from './sumup-checkout-orchestrator.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
const reference=checkoutReference(bookingId);
const checkout={checkoutId:'checkout-12345678',reference,amountPence:163000,
 currency:'GBP',status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/pay/checkout-12345678'};
const table='booking-staging';
test('LB-07 deterministic reference, provider-first lookup, and atomic registration',async()=>{
 let created=0,lookups=0,transactions=0;
 const db={send:async command=>{
  if(command.input.Key)return {};
  transactions++;return {};
 }};
 const result=await createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async input=>{created++;assert.equal(input.reference,reference);return checkout;}},
  lookupProviderByReference:async ref=>{lookups++;assert.equal(ref,reference);return [];}});
 assert.equal(result.status,'REGISTERED');
 assert.equal(created,1);assert.equal(lookups,1);assert.equal(transactions,1);
 assert.equal(checkoutReference(bookingId),reference);
});
test('LB-07 provider lookup failure prevents creating a second checkout',async()=>{
 let created=0;
 const db={send:async()=>({})};
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>{created++;return checkout;}},
  lookupProviderByReference:async()=>{throw Error('Provider unavailable');}}),/Provider unavailable/);
 assert.equal(created,0);
});
test('LB-07 remote pending checkout is reused and never duplicated',async()=>{
 let created=0;
 const db={send:async command=>command.input.Key?{}:{}};
 const result=await createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>{created++;return checkout;}},
  lookupProviderByReference:async()=>[checkout]});
 assert.equal(result.status,'REGISTERED');assert.equal(created,0);
});
test('LB-07 failed registration never releases an unregistered payment URL',async()=>{
 const db={send:async command=>{
  if(command.input.Key)return {};
  throw Error('DynamoDB transaction failed');
 }};
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[]}),/requires reconciliation/);
});
test('LB-07 provider conflicts and unsafe environment fail closed',async()=>{
 const db={send:async()=>({})};
 await assert.rejects(createAndRegisterCheckout({db,table:'booking-production',bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[]}),/unavailable/);
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[checkout,checkout]}),/Multiple provider/);
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[{...checkout,amountPence:10}]}),/mismatch/);
});
