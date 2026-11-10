import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionAvailabilityHandler} from './production-availability-handler.mjs';

const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const event={rawPath:'/availability',requestContext:{http:{method:'GET'}}};

test('production availability is read-only and returns the isolated master',async()=>{
 const db={send:async()=>({Items:[]})};
 const result=await createProductionAvailabilityHandler({db,table,environment:'production',airbnbRequired:false})(event);
 assert.equal(result.statusCode,200);
 const body=JSON.parse(result.body);
 assert.equal(body.mode,'LIVE_PRODUCTION_MASTER_READ_ONLY');
 assert.deepEqual(body.blocked,{geranium:[],honeysuckle:[]});
});

test('production availability fails closed without verified Airbnb snapshots',async()=>{
 const db={send:async()=>({Items:[]})};
 const result=await createProductionAvailabilityHandler({db,table,environment:'production',airbnbRequired:true})(event);
 assert.equal(result.statusCode,503);
 assert.deepEqual(JSON.parse(result.body),{error:'Availability cannot be verified'});
});

test('production availability rejects staging tables, writes and unrelated routes',async()=>{
 const db={send:async()=>{throw Error('must not read');}};
 const handler=createProductionAvailabilityHandler({db,table:'les-buttes-booking-staging-BookingTable-X',environment:'production'});
 assert.equal((await handler(event)).statusCode,503);
 const valid=createProductionAvailabilityHandler({db,table,environment:'production'});
 assert.equal((await valid({...event,requestContext:{http:{method:'POST'}}})).statusCode,404);
});
