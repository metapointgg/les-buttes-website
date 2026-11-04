import test from 'node:test';
import assert from 'node:assert/strict';
import {DescribeTableCommand} from '@aws-sdk/client-dynamodb';
import {inspectStagingBookingTable} from './lb08-ddb-staging-preflight.mjs';
const table='les-buttes-booking-staging-BookingTable-EXAMPLE123';
const env={AWS_REGION:'eu-west-2',BOOKING_ENVIRONMENT:'staging',
 LB08_READONLY_DDB_PREFLIGHT:'yes',BOOKINGS_TABLE:table};
const valid={Table:{TableName:table,TableStatus:'ACTIVE',
 TableArn:'arn:aws:dynamodb:eu-west-2:123456789012:table/'+table,
 KeySchema:[{AttributeName:'PK',KeyType:'HASH'},{AttributeName:'SK',KeyType:'RANGE'}]}};
test('LB-08 inspect only describes isolated staging table',async()=>{
 let calls=0,closed=0;
 const result=await inspectStagingBookingTable({env,clientFactory:()=>({
  send:async cmd=>{calls++;assert.ok(cmd instanceof DescribeTableCommand);
   assert.equal(cmd.input.TableName,table);return valid;},destroy:()=>closed++})});
 assert.equal(calls,1);assert.equal(closed,1);
 assert.equal(result.ready,true);assert.equal(result.partitionKey,'PK');
});
test('LB-08 rejects wrong environment and table before AWS access',async()=>{
 for(const modified of [{BOOKING_ENVIRONMENT:'production'},
  {BOOKINGS_TABLE:'les-buttes-booking-production-BookingTable-EXAMPLE123'},
  {AWS_REGION:'eu-west-1'},{LB08_READONLY_DDB_PREFLIGHT:'no'}]){
  await assert.rejects(inspectStagingBookingTable({env:{...env,...modified},
    clientFactory:()=>{throw Error('must not connect');}}),/authorisation/);
 }
});
test('LB-08 fails closed on inactive or invalid table schema',async()=>{
 for(const changed of [{TableStatus:'CREATING'},
  {KeySchema:[{AttributeName:'id',KeyType:'HASH'}]},
  {TableArn:'arn:aws:dynamodb:eu-west-2:123456789012:table/production'}]){
  await assert.rejects(inspectStagingBookingTable({env,
   clientFactory:()=>({send:async()=>({Table:{...valid.Table,...changed}})})}),
   /not active|schema mismatch|Unexpected staging/);
 }
});
