import test from 'node:test';import assert from 'node:assert/strict';
import {buildCheckoutRequest,validateCheckoutResponse,createSumUpClient} from './sumup-checkout-client.mjs';
const input={reference:'booking-12345',amountPence:163045,merchantCode:'MTEST123'};
test('LB-07 GBP minor units become major units and hosted checkout is enabled',()=>{
 const request=buildCheckoutRequest(input);
 assert.equal(request.amount,1630.45);assert.equal(request.currency,'GBP');
 assert.deepEqual(request.hosted_checkout,{enabled:true});
 assert.throws(()=>buildCheckoutRequest({...input,amountPence:1.5}),/amount/);
 assert.throws(()=>buildCheckoutRequest({...input,merchantCode:'wrong'}),/merchant/);
});
test('LB-07 rejects mismatched checkout, untrusted hosted URL and paid response',()=>{
 const request=buildCheckoutRequest(input);
 const response={id:'checkout-12345678',checkout_reference:input.reference,
  merchant_code:input.merchantCode,currency:'GBP',amount:1630.45,status:'PENDING',
  hosted_checkout_url:'https://checkout.sumup.com/pay/checkout-12345678'};
 assert.equal(validateCheckoutResponse(response,request).amountPence,163045);
 assert.throws(()=>validateCheckoutResponse({...response,amount:1630.46},request),/match/);
 assert.throws(()=>validateCheckoutResponse({...response,status:'PAID'},request),/status/);
 assert.throws(()=>validateCheckoutResponse({...response,hosted_checkout_url:'https://evil.example/pay'},request),/Untrusted/);
});
test('LB-07 sandbox client uses authenticated POST and read-only retrieval',async()=>{
 const calls=[];
 const client=createSumUpClient({enabled:true,apiKey:'sup_sk_mock',merchantCode:input.merchantCode,
  fetchImpl:async(url,options)=>{calls.push({url,options});
   if(url.endsWith('/v1/merchants/MTEST123'))return {ok:true,json:async()=>({merchant_code:'MTEST123',sandbox:true})};
   return {ok:true,json:async()=>options?.method==='POST'?{
    id:'checkout-12345678',checkout_reference:input.reference,merchant_code:input.merchantCode,
    currency:'GBP',amount:1630.45,status:'PENDING',
    hosted_checkout_url:'https://checkout.sumup.com/pay/checkout-12345678'
   }:{id:'checkout-12345678',status:'PENDING'}};
  }});
 const result=await client.createCheckout(input);
 assert.equal(result.status,'PENDING');
 assert.equal(calls[1].options.headers.Authorization,'Bearer sup_sk_mock');
 assert.equal(JSON.parse(calls[1].options.body).hosted_checkout.enabled,true);
 assert.equal((await client.retrieveCheckout('checkout-12345678')).status,'PENDING');
 assert.match(calls[2].url,/\/v0.1\/checkouts\/checkout-12345678$/);
 assert.throws(()=>createSumUpClient({enabled:true,apiKey:'sup_pk_public',merchantCode:input.merchantCode}),/Secret/);
 assert.throws(()=>createSumUpClient({enabled:false,apiKey:'sup_sk_mock',merchantCode:input.merchantCode}),/disabled/);
});

test('LB-08 checkout never posts if authenticated merchant is not a sandbox',async()=>{
 for(const merchant of [{merchant_code:'MTEST123',sandbox:false},{merchant_code:'OTHER123',sandbox:true},{}]){
  const calls=[];
  const client=createSumUpClient({enabled:true,apiKey:'sup_sk_mock',merchantCode:input.merchantCode,
   fetchImpl:async(url)=>{calls.push(url);return {ok:true,json:async()=>merchant};}});
  await assert.rejects(client.createCheckout(input),/Sandbox merchant verification required/);
  assert.deepEqual(calls,['https://api.sumup.com/v1/merchants/MTEST123']);
 }
});

test('LB-08 reference lookup filters by exact reference and validates merchant and hosted URL',async()=>{
 const calls=[],reference='lb-1234567890abcdef';
 const checkout={id:'eb6a0f73-c344-42b4-95ec-70aa296d1496',
  checkout_reference:reference,merchant_code:'MTEST123',currency:'GBP',
  amount:1,status:'PENDING',
  hosted_checkout_url:'https://checkout.sumup.com/pay/c-eb6a0f73-c344-42b4-95ec-70aa296d1496'};
 const client=createSumUpClient({enabled:true,apiKey:'sup_sk_mock',merchantCode:'MTEST123',
  fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>[checkout]};}});
 const list=await client.listCheckoutsByReference(reference);
 assert.equal(calls.length,1);
 assert.equal(calls[0],'https://api.sumup.com/v0.1/checkouts?checkout_reference='+reference);
 assert.equal(list[0].reference,reference);
 assert.equal(list[0].amountPence,100);
 assert.equal(list[0].status,'PENDING');
 assert.equal(list[0].hostedCheckoutUrl,checkout.hosted_checkout_url);
});
test('LB-08 reference lookup fails closed for malformed, wrong-merchant and incomplete provider records',async()=>{
 const reference='lb-1234567890abcdef';
 const base={id:'eb6a0f73-c344-42b4-95ec-70aa296d1496',
  checkout_reference:reference,merchant_code:'MTEST123',
  currency:'GBP',amount:1,status:'PENDING',
  hosted_checkout_url:'https://checkout.sumup.com/pay/checkout-1234'};
 for(const item of [{...base,merchant_code:'MOTHER'}, {...base,checkout_reference:'other'},
  {...base,status:'PAID'}, {...base,hosted_checkout_url:undefined},
  {...base,hosted_checkout_url:'https://example.invalid/checkout'}]){
  const client=createSumUpClient({enabled:true,apiKey:'sup_sk_mock',merchantCode:'MTEST123',
   fetchImpl:async()=>({ok:true,json:async()=>[item]})});
  await assert.rejects(client.listCheckoutsByReference(reference),/mismatch|hosted URL/);
 }
 const client=createSumUpClient({enabled:true,apiKey:'sup_sk_mock',merchantCode:'MTEST123',
  fetchImpl:async()=>({ok:true,json:async()=>({items:[]})})});
 await assert.rejects(client.listCheckoutsByReference(reference),/Untrusted/);
 await assert.rejects(client.listCheckoutsByReference('unsafe reference'),/Invalid/);
});
