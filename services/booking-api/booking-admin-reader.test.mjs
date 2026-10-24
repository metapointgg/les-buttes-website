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
 const page=await api.listBookings({},{limit:10});
 assert.equal(page.indexRequired,true);
 await assert.rejects(api.listBookings({},{limit:101}),/Invalid page size/);
});
