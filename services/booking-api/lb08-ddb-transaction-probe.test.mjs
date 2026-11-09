import test from 'node:test';
import assert from 'node:assert/strict';
import {TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {probeStagingTransaction} from './lb08-ddb-transaction-probe.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',
 LB08_IMPOSSIBLE_TRANSACTION_PROBE:'yes',
 BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
test('LB-08 transaction test uses impossible condition and isolated key only',async()=>{
 let calls=0;
 const result=await probeStagingTransaction({env,clientFactory:()=>({
  send:async cmd=>{
   calls++;assert.ok(cmd instanceof TransactWriteCommand);
   assert.equal(cmd.input.TransactItems.length,1);
   const put=cmd.input.TransactItems[0].Put;
   assert.match(put.Item.PK,/^LB08_PROBE#[0-9a-f-]{36}$/);
   assert.equal(put.ConditionExpression,'attribute_exists(PK) AND attribute_not_exists(PK)');
   assert.equal(put.TableName,env.BOOKINGS_TABLE);
   throw Object.assign(new Error('conditional cancellation'),{name:'TransactionCanceledException',
    CancellationReasons:[{Code:'ConditionalCheckFailed'}]});
  }} )});
 assert.equal(calls,1);assert.equal(result.bookingRecordsModified,false);
 assert.equal(result.transactionApiAccessible,true);
});
test('LB-08 blocks production and missing explicit authorisation',async()=>{
 for(const patch of [{BOOKING_ENVIRONMENT:'production'},
  {BOOKINGS_TABLE:'les-buttes-booking-production-BookingTable-X'},
  {LB08_IMPOSSIBLE_TRANSACTION_PROBE:'no'}])
  await assert.rejects(probeStagingTransaction({env:{...env,...patch},
   clientFactory:()=>{throw Error('must not call AWS');}}),/authorisation required/);
});
test('LB-08 does not mistake IAM denial for conditional success',async()=>{
 await assert.rejects(probeStagingTransaction({env,clientFactory:()=>({
  send:async()=>{throw Object.assign(new Error('not authorised'),{name:'AccessDeniedException'});}
 })}),/AccessDeniedException/);
});
