import test from 'node:test';
import assert from 'node:assert/strict';
import {readSyntheticCheckout} from './sumup-synthetic-checkout-read.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 LB08_READ_SYNTHETIC_CHECKOUT:'yes',LB08_CHECKOUT_ID:'eb6a0f73-c344-42b4-95ec-70aa296d1496'};
const ssmFactory=()=>({send:async command=>({Parameter:{Value:command.input.Name.endsWith('api-key')?
 'sup_sk_example':'ABCDEF12'}}),destroy(){}});
test('LB-08 transaction diagnostics redact provider payload while preserving evidence',async()=>{
 const result=await readSyntheticCheckout({env,ssmFactory,clientFactory:()=>({
  retrieveCheckout:async()=>({id:env.LB08_CHECKOUT_ID,merchant_code:'ABCDEF12',
   amount:1,currency:'GBP',status:'PAID',
   transactions:[{id:'TAAA7ATQ9B9',status:'SUCCESSFUL',amount:1,currency:'GBP',
    merchant_code:'ABCDEF12',card:{pan:'private-test-data'}}]})})});
 assert.equal(result.transactionCount,1);
 assert.equal(result.transactions[0].amountPence,100);
 assert.equal(result.transactions[0].merchantMatched,true);
 assert.equal(JSON.stringify(result).includes('private-test-data'),false);
});
test('LB-08 transaction diagnostics expose missing optional fields without inventing data',async()=>{
 const result=await readSyntheticCheckout({env,ssmFactory,clientFactory:()=>({
  retrieveCheckout:async()=>({id:env.LB08_CHECKOUT_ID,merchant_code:'ABCDEF12',
   amount:1,currency:'GBP',status:'PAID',transactions:[{id:'TAAA7ATQ9B9',status:'SUCCESSFUL'}]})})});
 assert.equal(result.transactions[0].hasAmount,false);
 assert.equal(result.transactions[0].hasMerchantCode,false);
 assert.equal(result.transactions[0].amountPence,null);
});
