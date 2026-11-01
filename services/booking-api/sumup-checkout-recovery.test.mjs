import test from 'node:test';import assert from 'node:assert/strict';
import {inspectCheckoutRecovery} from './sumup-checkout-recovery.mjs';
import {checkoutReference} from './sumup-checkout-orchestrator.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
const reference=checkoutReference(bookingId);
const claim={reference,amountPence:163000,status:'RECONCILE_REQUIRED'};
const checkout={reference,amountPence:163000,currency:'GBP',checkoutId:'checkout-12345678',status:'PENDING'};
function dbWith({claimItem=claim,registeredItem}={}){
 return {send:async command=>({Item:command.input.Key.SK==='PAYMENT#CREATION_CLAIM'?claimItem:registeredItem})};
}
test('LB-07 recovery distinguishes orphaned provider checkout from missing provider record',async()=>{
 const found=await inspectCheckoutRecovery({db:dbWith(),table:'booking-staging',bookingId,
  lookupProviderByReference:async()=>[checkout]});
 assert.equal(found.state,'PROVIDER_FOUND_UNREGISTERED');
 assert.equal(found.checkoutId,checkout.checkoutId);
 const missing=await inspectCheckoutRecovery({db:dbWith(),table:'booking-staging',bookingId,
  lookupProviderByReference:async()=>[]});
 assert.equal(missing.state,'CLAIM_UNRESOLVED');
});
test('LB-07 recovery fails closed on provider conflict and outage',async()=>{
 const conflicting=await inspectCheckoutRecovery({db:dbWith(),table:'booking-staging',bookingId,
  lookupProviderByReference:async()=>[{...checkout,amountPence:1}]});
 assert.equal(conflicting.state,'PROVIDER_CONFLICT');
 await assert.rejects(inspectCheckoutRecovery({db:dbWith(),table:'booking-staging',bookingId,
  lookupProviderByReference:async()=>{throw Error('SumUp unavailable');}}),/unavailable/);
});
test('LB-07 recovery reports local registration without provider lookup',async()=>{
 const state=await inspectCheckoutRecovery({db:dbWith({registeredItem:{reference,checkoutId:'checkout-12345678'}}),
  table:'booking-staging',bookingId,lookupProviderByReference:async()=>{throw Error('must not query');}});
 assert.equal(state.state,'REGISTERED');
 const none=await inspectCheckoutRecovery({db:dbWith({claimItem:null}),table:'booking-staging',
  bookingId,lookupProviderByReference:async()=>[]});
 assert.equal(none.state,'NOT_STARTED');
});
