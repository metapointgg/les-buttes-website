import test from 'node:test';
import assert from 'node:assert/strict';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {probeAtomicStagingTransaction} from './lb08-ddb-atomic-staging-probe.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 LB08_ATOMIC_SYNTHETIC_WRITE:'yes',
 BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
const uuid='11111111-1111-4111-8111-111111111111';
test('LB-08 commits, verifies, rejects replay and deletes isolated diagnostics',async()=>{
 const operations=[];let closed=false;
 const result=await probeAtomicStagingTransaction({env,uuid:()=>uuid,clientFactory:()=>({
  async send(cmd){
   if(cmd instanceof GetCommand){operations.push('get');return {Item:{runId:uuid,kind:'LB08_ATOMIC_PROBE'}};}
   assert.ok(cmd instanceof TransactWriteCommand);
   const items=cmd.input.TransactItems;assert.equal(items.length,2);
   for(const item of items){
    const key=item.Put?.Item??item.Delete?.Key;
    assert.equal(key.PK,'LB08_SYNTHETIC_TRANSACTION#'+uuid);
    assert.match(key.SK,/^ATOMIC#[AB]$/);
   }
   if(items[0].Delete){operations.push('cleanup');return {};}
   operations.push('put');
   if(operations.filter(op=>op==='put').length===2)
    throw Object.assign(new Error('duplicate'),{name:'TransactionCanceledException',
     CancellationReasons:[{Code:'ConditionalCheckFailed'}]});
   return {};
  },destroy(){closed=true;}
 })});
 assert.deepEqual(operations,['put','get','get','put','cleanup']);
 assert.equal(result.passed,true);assert.equal(result.syntheticRecordsCleanedUp,true);
 assert.equal(closed,true);
});
test('LB-08 rejects production or missing operator consent before AWS calls',async()=>{
 for(const patch of [{BOOKING_ENVIRONMENT:'production'},
  {BOOKINGS_TABLE:'les-buttes-booking-production-BookingTable-ABC'},
  {LB08_ATOMIC_SYNTHETIC_WRITE:'no'}])
  await assert.rejects(probeAtomicStagingTransaction({env:{...env,...patch},
    clientFactory:()=>{throw Error('must not connect');}}),/authorisation required/);
});
test('LB-08 IAM denial cannot be reported as passing and does not delete',async()=>{
 let calls=0;
 await assert.rejects(probeAtomicStagingTransaction({env,uuid:()=>uuid,clientFactory:()=>({
  send:async()=>{calls++;throw Object.assign(new Error('denied'),{name:'AccessDeniedException'});}
 })}),/denied/);
 assert.equal(calls,1);
});
