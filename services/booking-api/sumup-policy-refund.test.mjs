import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand,PutCommand,TransactWriteCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {executePolicyRefund} from './sumup-policy-refund.mjs';
const id='11111111-1111-4111-8111-111111111111',table='les-buttes-booking-staging-BookingTable-TEST123';
const booking={id,synthetic:true,guestEmail:'test@example.invalid',source:'direct',status:'CANCELLED',
 refundStatus:'ASSESSED',refundDuePence:36750,paidAmountPence:73500,paymentTransactionId:'22222222-2222-4222-8222-222222222222',
 refundPolicyVersion:'version-1',refundPolicyId:'DIRECT_AIRBNB_STRICT_SHORT_STAY_V1',refundPercent:50};
const checkout={amountPence:73500,currency:'GBP'};
const evidence=refundedPence=>({transactionId:booking.paymentTransactionId,currency:'GBP',paidPence:73500,refundedPence,refundPending:false});
function harness({existingClaim,postError}={}){
 const commands=[];let reads=0,posts=0;
 const db={send:async command=>{commands.push(command);
  if(command instanceof GetCommand){const sk=command.input.Key.SK;
   return {Item:sk==='META'?booking:sk==='PAYMENT#CHECKOUT'?checkout:existingClaim};}
  if(command instanceof PutCommand||command instanceof UpdateCommand||command instanceof TransactWriteCommand)return {};
  throw Error('unexpected');}};
 return {db,commands,readProvider:async()=>evidence(++reads===1?0:36750),
  requestProviderRefund:async request=>{posts++;assert.deepEqual(request,{transactionId:booking.paymentTransactionId,amountPence:36750,full:false});if(postError)throw postError;},
  get posts(){return posts;}};
}
test('partial policy refund is claimed, provider-verified and atomically audited',async()=>{
 const h=harness();const result=await executePolicyRefund({db:h.db,table,bookingId:id,readProvider:h.readProvider,
  requestProviderRefund:h.requestProviderRefund,enabled:true,now:()=> '2026-11-09T23:00:00.000Z'});
 assert.equal(result.status,'REFUNDED');assert.equal(result.amountPence,36750);assert.equal(h.posts,1);
 const tx=h.commands.find(x=>x instanceof TransactWriteCommand);assert.equal(tx.input.TransactItems.length,3);
});
test('ambiguous provider outcome is never resubmitted',async()=>{
 const h=harness({postError:Error('timeout')});
 await assert.rejects(executePolicyRefund({db:h.db,table,bookingId:id,readProvider:h.readProvider,
  requestProviderRefund:h.requestProviderRefund,enabled:true}),/timeout/);
 assert.equal(h.posts,1);assert.ok(h.commands.some(x=>x instanceof UpdateCommand));
});
test('existing verified claim returns idempotently without another POST',async()=>{
 const claim={PK:'BOOKING#'+id,SK:'REFUND#POLICY',bookingId:id,transactionId:booking.paymentTransactionId,
  amountPence:36750,policyVersion:'version-1',policyId:booking.refundPolicyId,refundPercent:50,state:'REFUNDED'};
 const h=harness({existingClaim:claim});h.readProvider=async()=>evidence(36750);
 const result=await executePolicyRefund({db:h.db,table,bookingId:id,readProvider:h.readProvider,
  requestProviderRefund:h.requestProviderRefund,enabled:true});
 assert.equal(result.status,'ALREADY_REFUNDED');assert.equal(h.posts,0);
});
