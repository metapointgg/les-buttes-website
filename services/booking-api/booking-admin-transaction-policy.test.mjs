import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOwnerTransition} from './booking-admin-transaction-policy.mjs';
const booking={id:'11111111-1111-4111-8111-111111111111',status:'REQUESTED',
 holdExpiresAt:200,units:['geranium','honeysuckle'],start:'2027-08-28',end:'2027-09-04'};
const request={identity:{role:'owner'},action:'approve',booking,nowEpoch:100};
test('prepares every cottage-night for one atomic transaction',()=>{
 const result=prepareOwnerTransition(request);
 assert.equal(result.allowed,true);
 assert.equal(result.slots.length,14);
 assert.deepEqual(result.slots[0],{PK:'UNIT#geranium',SK:'DATE#2027-08-28'});
 assert.deepEqual(result.slots[13],{PK:'UNIT#honeysuckle',SK:'DATE#2027-09-03'});
 assert.deepEqual(result.metadataKey,{PK:'BOOKING#'+booking.id,SK:'META'});
});
test('fails closed on invalid allocation, dates and expired hold',()=>{
 for(const units of [[],['geranium','geranium'],['unknown'],['geranium','honeysuckle','unknown']])
   assert.equal(prepareOwnerTransition({...request,booking:{...booking,units}}).allowed,false);
 for(const [start,end] of [['2027-02-30','2027-03-07'],['2027-08-28','2027-08-28'],
   ['2027-08-28','2027-10-02'],['invalid','2027-09-04']])
   assert.equal(prepareOwnerTransition({...request,booking:{...booking,start,end}}).allowed,false);
 assert.equal(prepareOwnerTransition({...request,nowEpoch:200}).allowed,false);
 assert.equal(prepareOwnerTransition({...request,booking:{...booking,id:'bad'}}).allowed,false);
});

test('invalid or absent booking dates fail closed without throwing',()=>{
 for(const [start,end] of [[undefined,'2027-09-04'],['2027-08-28',undefined],
   [null,'2027-09-04'],['not-a-date','2027-09-04'],
   ['2027-02-30','2027-03-07'],['2027-13-01','2027-13-08']]){
   assert.doesNotThrow(()=>{
     const decision=prepareOwnerTransition({...request,booking:{...booking,start,end}});
     assert.equal(decision.allowed,false);
   });
 }
});
