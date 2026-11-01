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
 const client=createSumUpClient({enabled:true,apiKey:'sup_sk_test_mock',merchantCode:input.merchantCode,
  fetchImpl:async(url,options)=>{calls.push({url,options});
   return {ok:true,json:async()=>options?.method==='POST'?{
    id:'checkout-12345678',checkout_reference:input.reference,merchant_code:input.merchantCode,
    currency:'GBP',amount:1630.45,status:'PENDING',
    hosted_checkout_url:'https://checkout.sumup.com/pay/checkout-12345678'
   }:{id:'checkout-12345678',status:'PENDING'}};
  }});
 const result=await client.createCheckout(input);
 assert.equal(result.status,'PENDING');
 assert.equal(calls[0].options.headers.Authorization,'Bearer sup_sk_test_mock');
 assert.equal(JSON.parse(calls[0].options.body).hosted_checkout.enabled,true);
 assert.equal((await client.retrieveCheckout('checkout-12345678')).status,'PENDING');
 assert.match(calls[1].url,/\/v0.1\/checkouts\/checkout-12345678$/);
 assert.throws(()=>createSumUpClient({enabled:true,apiKey:'sup_sk_live_secret',merchantCode:input.merchantCode}),/Sandbox/);
 assert.throws(()=>createSumUpClient({enabled:false,apiKey:'sup_sk_test_mock',merchantCode:input.merchantCode}),/disabled/);
});
