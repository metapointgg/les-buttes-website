import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingAdminReader} from './booking-admin-reader.mjs';
const table='single-master';
const identity=async()=>({role:'admin'});
test('reads published pricing from the shared booking table',async()=>{
 const calls=[];
 const db={send:async command=>{calls.push(command.input);return {Item:{version:'v1',value:{ranges:[]}}};}};
 const api=bookingAdminReader({db,table,authorise:identity});
 const result=await api.getConfig({},'pricing','geranium');
 assert.equal(result.version,'v1');
 assert.equal(calls[0].TableName,table);
 assert.deepEqual(calls[0].Key,{PK:'CONFIG#pricing#geranium',SK:'CURRENT'});
});
test('denies unauthenticated access before database query',async()=>{
 let called=false;
 const db={send:async()=>{called=true;return {};}};
 const api=bookingAdminReader({db,table,authorise:async()=>null});
 await assert.rejects(api.getConfig({},'payments'),/Unauthorised/);
 assert.equal(called,false);
});
test('rejects malformed booking ids and unindexed booking listing',async()=>{
 const api=bookingAdminReader({db:{send:async()=>{throw Error('unexpected')}},table,authorise:identity});
 await assert.rejects(api.getBooking({},'../../secrets'),/Invalid reference/);
 await assert.rejects(api.listBookings({},{limit:10}),/index not configured/);
 await assert.rejects(api.listBookings({},{limit:101}),/Invalid page size/);
});

test('booking inbox queries a GSI on the SAME table',async()=>{
 let query;
 const db={send:async cmd=>{query=cmd.input;return {Items:[{id:'abc'}]};}};
 const api=bookingAdminReader({db,table,authorise:identity,bookingIndex:'BookingRequestsIndex'});
 const page=await api.listBookings({},{limit:12});
 assert.equal(query.TableName,table);
 assert.equal(query.IndexName,'BookingRequestsIndex');
 assert.equal(query.Limit,12);
 assert.equal(page.items.length,1);
});

test('LB-03 audit history is strongly consistent, scoped and paginated',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const cursor={PK:'BOOKING#'+id,SK:'AUDIT#2026-10-31T12:00:00.000Z#abc'};
 let query;
 const api=bookingAdminReader({db:{send:async command=>{
   query=command.input;return {Items:[{action:'approve'}],LastEvaluatedKey:cursor};
 }},table,authorise:identity});
 const page=await api.getBookingAudit({},id,{limit:5});
 assert.equal(query.TableName,table);
 assert.equal(query.ConsistentRead,true);
 assert.equal(query.Limit,5);
 assert.equal(query.ExpressionAttributeValues[':pk'],'BOOKING#'+id);
 assert.equal(query.ExpressionAttributeValues[':prefix'],'AUDIT#');
 assert.equal(page.items[0].action,'approve');
 assert.deepEqual(page.nextCursor,cursor);
 await api.getBookingAudit({},id,{cursor});
 assert.deepEqual(query.ExclusiveStartKey,cursor);
 await assert.rejects(api.getBookingAudit({},id,{cursor:{PK:'BOOKING#other',SK:'AUDIT#x'}}),/Invalid cursor/);
 await assert.rejects(api.getBookingAudit({},id,{limit:101}),/Invalid page size/);
});
test('LB-03 unauthorised audit read cannot query DynamoDB',async()=>{
 let called=false;
 const api=bookingAdminReader({db:{send:async()=>{called=true;return {};}},table,authorise:async()=>null});
 await assert.rejects(api.getBookingAudit({},'11111111-1111-4111-8111-111111111111'),/Unauthorised/);
 assert.equal(called,false);
});
