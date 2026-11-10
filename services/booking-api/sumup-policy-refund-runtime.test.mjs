import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSandboxPolicyRefund} from './sumup-policy-refund-runtime.mjs';

const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 BOOKING_SANDBOX_POLICY_REFUND_ACCEPTANCE:'true'};

test('sandbox policy refund sends partial amount in major units to established transaction endpoint',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,status:204,json:async()=>({})};
 };
 const ssm={destroyed:false,destroy(){this.destroyed=true;}};
 const result=await executeSandboxPolicyRefund({db:{send(){}},table:'les-buttes-booking-staging-BookingTable-TEST123',
  bookingId:'12345678-1234-1234-1234-123456789abc',env,fetchImpl,ssm,
  verifyMerchant:async()=>({sandboxVerified:true,merchantMatched:true}),
  loadCredentials:async()=>({apiKey:'sup_sk_test',merchantCode:'TESTCODE'}),
  execute:async({requestProviderRefund,enabled})=>{
   assert.equal(enabled,true);
   await requestProviderRefund({transactionId:'87654321-4321-4321-4321-cba987654321',amountPence:40250,full:false});
   return {status:'REFUNDED'};
  }});
 assert.deepEqual(result,{status:'REFUNDED'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.sumup.com/v0.1/me/refund/87654321-4321-4321-4321-cba987654321');
 assert.equal(calls[0].options.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].options.body),{amount:402.5});
 assert.equal(ssm.destroyed,true);
});

test('full sandbox policy refund omits the request body',async()=>{
 let options;
 const fetchImpl=async(_url,value)=>{options=value;return {ok:true,status:204};};
 await executeSandboxPolicyRefund({db:{send(){}},table:'les-buttes-booking-staging-BookingTable-TEST123',
  bookingId:'12345678-1234-1234-1234-123456789abc',env,fetchImpl,ssm:{destroy(){}},
  verifyMerchant:async()=>({sandboxVerified:true,merchantMatched:true}),
  loadCredentials:async()=>({apiKey:'sup_sk_test',merchantCode:'TESTCODE'}),
  execute:async({requestProviderRefund})=>{
   await requestProviderRefund({transactionId:'87654321-4321-4321-4321-cba987654321',amountPence:73500,full:true});
   return {status:'REFUNDED'};
  }});
 assert.equal(Object.hasOwn(options,'body'),false);
});
