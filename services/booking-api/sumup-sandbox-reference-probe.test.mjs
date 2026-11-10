import test from 'node:test';
import assert from 'node:assert/strict';
import {probeCheckoutReference} from './sumup-sandbox-reference-probe.mjs';
const checkoutId='eb6a0f73-c344-42b4-95ec-70aa296d1496';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 LB08_READONLY_REFERENCE_PROBE:'yes',LB08_CHECKOUT_ID:checkoutId};
const merchant='MTEST123';
const ssmFactory=()=>({send:async command=>({Parameter:{Value:
 command.input.Name.endsWith('api-key')?'sup_sk_mock':merchant}}),destroy(){}});
test('LB-08 reference probe verifies existing PAID checkout without creation',async()=>{
 let reads=0,listings=0;
 const result=await probeCheckoutReference({env,ssmFactory,clientFactory:()=>({
  retrieveCheckout:async id=>{reads++;assert.equal(id,checkoutId);
   return {id,checkout_reference:'lb08_existing_123',amount:1,currency:'GBP',
    merchant_code:merchant,status:'PAID'};},
  inspectCheckoutReference:async ref=>{listings++;
   assert.equal(ref,'lb08_existing_123');
   return [{checkoutId,status:'PAID',amountPence:100,referenceMatched:true,
    merchantMatched:true,reusablePending:false}];}
 })});
 assert.equal(result.verified,true);assert.equal(result.checkoutStatus,'PAID');
 assert.equal(result.noCheckoutCreated,true);assert.equal(reads,1);assert.equal(listings,1);
});
test('LB-08 reference probe refuses production and invalid checkout ID',async()=>{
 for(const patch of [{BOOKING_ENVIRONMENT:'production'},
  {LB08_READONLY_REFERENCE_PROBE:'no'},{LB08_CHECKOUT_ID:'unsafe'}]){
  await assert.rejects(probeCheckoutReference({env:{...env,...patch},
   ssmFactory:()=>{throw Error('must not connect');}}),/authorisation required/);
 }
});
test('LB-08 reference probe rejects missing and duplicate provider matches',async()=>{
 for(const matches of [[],[{checkoutId,status:'PAID',amountPence:100,
   referenceMatched:true,merchantMatched:true},{checkoutId:'another',status:'PAID'}]]){
  await assert.rejects(probeCheckoutReference({env,ssmFactory,clientFactory:()=>({
   retrieveCheckout:async()=>({id:checkoutId,checkout_reference:'lb08_existing_123',
    merchant_code:merchant,currency:'GBP',amount:1,status:'PAID'}),
   inspectCheckoutReference:async()=>matches
  })}),/evidence mismatch/);
 }
});
