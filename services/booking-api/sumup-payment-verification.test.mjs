import test from 'node:test';import assert from 'node:assert/strict';
import {verifySumUpPayment} from './sumup-payment-verification.mjs';
const booking={id:'11111111-1111-4111-8111-111111111111',source:'direct',
 reservationStatus:'AWAITING_PAYMENT',approvedAmountGBP:1630};
const registered={bookingId:booking.id,checkoutId:'checkout-12345678',reference:'booking-12345',
 merchantCode:'MTEST123',amountPence:163000,currency:'GBP'};
const provider={id:registered.checkoutId,checkout_reference:registered.reference,
 merchant_code:registered.merchantCode,amount:1630,currency:'GBP',status:'PAID',
 transactions:[{id:'transaction-12345',status:'SUCCESSFUL',amount:1630,currency:'GBP',merchant_code:'MTEST123'}]};
const verify=(overrides={})=>verifySumUpPayment({registered,booking,provider,...overrides});
test('LB-08 accepts only independently verified matching SumUp payment',()=>{
 const result=verify({now:new Date('2026-11-01T12:00:00.000Z')});
 assert.equal(result.verified,true);
 assert.equal(result.transactionId,'transaction-12345');
 assert.equal(result.amountPence,163000);
});
test('LB-08 rejects redirect or webhook-only assertion, pending and failed payments',()=>{
 assert.equal(verify({provider:null}).verified,false);
 assert.equal(verify({provider:{...provider,status:'PENDING'}}).verified,false);
 assert.equal(verify({provider:{...provider,transactions:[]}}).verified,false);
 assert.equal(verify({provider:{...provider,transactions:[{id:'transaction-12345',status:'FAILED'}]}}).verified,false);
});
test('LB-08 rejects amount, merchant, currency, checkout and booking mismatches',()=>{
 for(const altered of [
  {amount:1630.01},{merchant_code:'OTHER'}, {currency:'EUR'},
  {checkout_reference:'different'}, {id:'checkout-99999999'}
 ])assert.equal(verify({provider:{...provider,...altered}}).verified,false);
 assert.equal(verify({booking:{...booking,reservationStatus:'CONFIRMED'}}).verified,false);
 assert.equal(verify({booking:{...booking,approvedAmountGBP:100}}).verified,false);
 assert.equal(verify({registered:{...registered,bookingId:'another'}}).verified,false);
});
test('LB-08 rejects ambiguous transaction evidence',()=>{
 assert.equal(verify({provider:{...provider,transactions:[...provider.transactions,...provider.transactions]}}).verified,false);
});

test('LB-08 rejects transaction-level amount currency or merchant manipulation',()=>{
 for(const fields of [{amount:1629},{currency:'EUR'},{merchant_code:'DIFFERENT'}, {amount:undefined}]){
  const transaction={...provider.transactions[0],...fields};
  assert.equal(verify({provider:{...provider,transactions:[transaction]}}).verified,false);
 }
});
