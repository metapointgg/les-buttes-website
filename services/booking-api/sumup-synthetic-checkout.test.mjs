import test from 'node:test';
import assert from 'node:assert/strict';
import {runSyntheticCheckout} from './sumup-synthetic-checkout.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',LB08_CREATE_SYNTHETIC_CHECKOUT:'yes'};
test('LB-08 synthetic checkout requires explicit staging approval before reading secrets',async()=>{
 for(const invalid of [{},{...env,BOOKING_ENVIRONMENT:'production'},
  {...env,LB08_CREATE_SYNTHETIC_CHECKOUT:'no'}])
  await assert.rejects(runSyntheticCheckout({env:invalid,ssmFactory:()=>{throw Error('should not read');}}),/authorisation required/);
});
test('LB-08 synthetic checkout creates exactly one £1 checkout and never touches booking records',async()=>{
 const operations=[];let closed=0;
 const result=await runSyntheticCheckout({env,
  ssmFactory:()=>({send:async command=>{
   operations.push(command.input.Name);
   return {Parameter:{Value:command.input.Name.endsWith('/api-key')?'sup_sk_mock':'ABCDEF12'}};
  },destroy:()=>closed++}),
  clientFactory:({apiKey,merchantCode,enabled})=>{
   assert.equal(apiKey,'sup_sk_mock');assert.equal(merchantCode,'ABCDEF12');assert.equal(enabled,true);
   return {createCheckout:async input=>{
    operations.push('checkout');assert.equal(input.amountPence,100);
    assert.match(input.reference,/^lb08_[a-f0-9]{24}$/);
    return {checkoutId:'checkout-12345',status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/test'};
   }};
  }});
 assert.equal(closed,1);assert.equal(result.created,true);assert.equal(result.amountPence,100);
 assert.equal(operations.filter(op=>op==='checkout').length,1);
 assert.equal(JSON.stringify(result).includes('sup_sk_mock'),false);
});
