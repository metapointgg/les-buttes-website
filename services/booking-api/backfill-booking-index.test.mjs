import test from 'node:test';
import assert from 'node:assert/strict';
import {indexKey,indexUpdate,run} from './backfill-booking-index.mjs';

const id='e3b0c442-98fc-1c14-9afb-4c8996fb9242';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const row={PK:'BOOKING#'+id,SK:'META',id,source:'direct',requestedAt:'2026-10-24T19:25:00.000Z'};
test('candidate index keys use same table and omit already indexed/external bookings',()=>{
 assert.deepEqual(indexKey(row),{pk:'BOOKING_REQUESTS',sk:row.requestedAt+'#'+id});
 assert.equal(indexKey({...row,source:'airbnb'}),null);
 assert.equal(indexKey({...row,GSI1PK:'BOOKING_REQUESTS'}),null);
 assert.equal(indexKey({...row,PK:'UNIT#geranium'}),null);
 const update=indexUpdate(table,row,indexKey(row));
 assert.deepEqual(update.Key,{PK:row.PK,SK:'META'});
 assert.equal(update.TableName,table);
 assert.ok(update.ConditionExpression.includes('attribute_not_exists'));
 assert.ok(!JSON.stringify(update).includes('guestEmail'));
});
test('safe dry run never changes booking records',async()=>{
 const original={env:process.env.BOOKING_ENVIRONMENT,region:process.env.AWS_REGION};
 process.env.BOOKING_ENVIRONMENT='staging';process.env.AWS_REGION='eu-west-2';
 try{
  let commands=[],messages=[];
  const db={send:async command=>{commands.push(command.constructor.name);return {Items:[row,{...row,source:'airbnb'}]};}};
  const result=await run({db,table,apply:false,log:x=>messages.push(x)});
  assert.deepEqual(commands,['ScanCommand']);
  assert.deepEqual(result,{count:2,eligible:1,skipped:1,applied:false});
  assert.match(messages[0],/DRY RUN/);
 }finally{
  if(original.env===undefined)delete process.env.BOOKING_ENVIRONMENT;else process.env.BOOKING_ENVIRONMENT=original.env;
  if(original.region===undefined)delete process.env.AWS_REGION;else process.env.AWS_REGION=original.region;
 }
});
test('migration refuses production or wrong table',async()=>{
 const before=process.env.BOOKING_ENVIRONMENT,region=process.env.AWS_REGION;
 process.env.BOOKING_ENVIRONMENT='production';process.env.AWS_REGION='eu-west-2';
 try{await assert.rejects(run({db:{send:async()=>({Items:[]})},table,log:()=>{}}),/Refusing non-staging/);}
 finally{
  if(before===undefined)delete process.env.BOOKING_ENVIRONMENT;else process.env.BOOKING_ENVIRONMENT=before;
  if(region===undefined)delete process.env.AWS_REGION;else process.env.AWS_REGION=region;
 }
});
