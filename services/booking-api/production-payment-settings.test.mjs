import test from 'node:test';
import assert from 'node:assert/strict';
import {readProductionPaymentSettings,publishProductionPaymentSettings} from './production-payment-settings.mjs';
import {DEFAULT_PAYMENT_POLICY} from './booking-payment-policy.mjs';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const owner={role:'owner',subject:'owner-user-id'};
const half={depositPercent:50,balanceDueDays:14,fullPaymentWithinDays:30,reminderMonths:[3,2,1]};

test('no production payment setting preserves 100% due on approval',async()=>{
 const db={send:async()=>({})};
 const current=await readProductionPaymentSettings({db,table});
 assert.deepEqual(current,{version:null,value:{...DEFAULT_PAYMENT_POLICY},isDefault:true});
 assert.equal(current.value.depositPercent,100);
});
test('owner can create 50% global setting using a versioned conditional transaction',async()=>{
 let written;
 const db={send:async command=>{
  if(command.input.Key)return {};
  written=command.input;return {};
 }};
 const result=await publishProductionPaymentSettings({db,table,identity:owner,value:half,
  expectedVersion:null,approved:true});
 assert.equal(result.kind,'payments');
 assert.equal(result.unit,'all');
 assert.equal(written.TransactItems.length,2);
 assert.equal(written.TransactItems[1].Put.Item.value.depositPercent,50);
 assert.equal(written.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(written.TransactItems[1].Put.Item.approvedBy,owner.subject);
});
test('viewer, missing explicit approval and stale version cannot change live policy',async()=>{
 let calls=0;
 const db={send:async command=>{
  calls++;return command.input.Key?{Item:{PK:'CONFIG#payments#all',SK:'CURRENT',
   version:'2026-11-14T08:00:00.000Z#last',value:half}}:{};
 }};
 for(const args of [
  {identity:{role:'viewer',subject:'viewer'},approved:true,expectedVersion:null},
  {identity:owner,approved:false,expectedVersion:null},
  {identity:owner,approved:true,expectedVersion:null}
 ]){
  await assert.rejects(publishProductionPaymentSettings({db,table,value:half,...args}));
 }
 assert.equal(calls,1,'failed owner approval and mismatched CAS must never write');
});
