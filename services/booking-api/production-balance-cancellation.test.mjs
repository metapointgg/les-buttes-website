import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyBalanceCheckoutDeactivated} from './production-balance-cancellation.mjs';
const id='11111111-1111-4111-8111-111111111111';
const booking={id,paymentStatus:'PARTIALLY_PAID',balanceDuePence:40250};
const table='production';
const checkout={bookingId:id,checkoutId:'11111111-2222-4333-8444-555555555555',
 reference:'lb-11111111111111111111111111111111',amountPence:40250,currency:'GBP',status:'PENDING'};
const claim={reference:checkout.reference,amountPence:40250};
const provider={id:checkout.checkoutId,checkout_reference:checkout.reference,merchant_code:'M9BE4KMN',
 currency:'GBP',amount:402.5,status:'PENDING',transactions:[]};
const fixture=({existing=checkout,creationClaim=claim,statuses=['PENDING','EXPIRED']}={})=>{
 const calls=[];let count=0;
 const db={send:async c=>({Item:c.input.Key.SK.startsWith('PAYMENT#BALANCE_CREATION_CLAIM')?creationClaim:existing})};
 const sumup={merchantCode:'M9BE4KMN',
  retrieveCheckout:async()=>({...provider,status:statuses[Math.min(count++,statuses.length-1)]}),
  deactivateCheckout:async()=>{calls.push('deactivate');return {...provider,status:'EXPIRED'};}};
 return {db,sumup,calls};
};
test('unregistered balance with no creation claim is safe only with atomic writer claim guard',async()=>{
 const f=fixture({existing:null,creationClaim:null});
 const result=await verifyBalanceCheckoutDeactivated({db:f.db,table,booking,sumup:f.sumup});
 assert.deepEqual(result,{state:'NO_LINK',verified:true});
});
test('registered balance requires a separate SumUp GET after deactivation',async()=>{
 const f=fixture();
 const result=await verifyBalanceCheckoutDeactivated({db:f.db,table,booking,sumup:f.sumup});
 assert.equal(result.state,'EXPIRED');
 assert.equal(result.checkoutId,checkout.checkoutId);
 assert.deepEqual(f.calls,['deactivate']);
});
test('paid or still active link prevents cancellation and date release',async()=>{
 for(const states of [['PAID'],['PENDING','PENDING']]){
  const f=fixture({statuses:states});
  await assert.rejects(verifyBalanceCheckoutDeactivated({db:f.db,table,booking,sumup:f.sumup}));
 }
});
test('unregistered checkout with outstanding creation claim requires manual review',async()=>{
 const f=fixture({existing:null});
 await assert.rejects(verifyBalanceCheckoutDeactivated({db:f.db,table,booking,sumup:f.sumup}),/reviewed/);
});

test('expired balance checkout from a renewed session permits controlled cancellation only after provider verification',async()=>{
 const f=fixture({existing:{...checkout,status:'EXPIRED',attempt:2},statuses:['EXPIRED']});
 const state=await verifyBalanceCheckoutDeactivated({db:f.db,table,booking,sumup:f.sumup});
 assert.equal(state.state,'ALREADY_EXPIRED');
 assert.equal(state.attempt,2);
 assert.deepEqual(f.calls,[]);
});
