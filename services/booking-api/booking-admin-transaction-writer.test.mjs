import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
const id='11111111-1111-4111-8111-111111111111';
const base={id,status:'REQUESTED',holdExpiresAt:200,source:'direct',
 units:['geranium'],start:'2027-08-28',end:'2027-08-30'};
const owner={role:'owner',subject:'owner-1'};
const make=(booking=base)=>{
 const sent=[];
 return {sent,params:{db:{send:async command=>{sent.push(command.input);return {};}},table:'staging-bookings',
   readBooking:async()=>booking,identity:owner,bookingId:id,nowEpoch:100}};
};
test('decline atomically releases all nights with metadata hold and status conditions',async()=>{
 const {sent,params}=make();
 const result=await executeOwnerTransition({...params,action:'decline'});
 assert.deepEqual(result,{id,from:'REQUESTED',to:'DECLINED',releasedNights:2});
 assert.equal(sent.length,1);
 assert.equal(sent[0].TransactItems.length,3);
 assert.match(sent[0].TransactItems[0].Update.ConditionExpression,/holdExpiresAt > :now/);
 assert.equal(sent[0].TransactItems[1].Delete.ConditionExpression,'id = :id');
 assert.equal(sent[0].TransactItems[2].Delete.Key.SK,'DATE#2027-08-29');
});
test('cancel requires reason and releases confirmed booking without payment confirmation',async()=>{
 const {sent,params}=make({...base,status:'CONFIRMED'});
 await assert.rejects(executeOwnerTransition({...params,action:'cancel'}),/reason/);
 const result=await executeOwnerTransition({...params,action:'cancel',reason:'Guest requested cancellation'});
 assert.equal(result.to,'CANCELLED');
 assert.equal(sent.length,1);
 assert.equal(sent[0].TransactItems[0].Update.ExpressionAttributeValues[':reason'],'Guest requested cancellation');
});
test('rejects non-owner, unsupported approval, expired hold and mismatched booking',async()=>{
 const {sent,params}=make();
 await assert.rejects(executeOwnerTransition({...params,identity:{role:'admin'},action:'decline'}),/Forbidden/);
 await assert.rejects(executeOwnerTransition({...params,action:'approve'}),/not enabled/);
 await assert.rejects(executeOwnerTransition({...params,action:'decline',nowEpoch:200}),/expired/);
 await assert.rejects(executeOwnerTransition({...params,action:'decline',readBooking:async()=>({...base,id:'22222222-2222-4222-8222-222222222222'})}),/mismatch/);
 assert.equal(sent.length,0);
});
