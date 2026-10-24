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
