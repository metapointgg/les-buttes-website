import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionQuoteHandler} from './production-quote-handler.mjs';
import {handler as disabledRequest} from './production-request-disabled-handler.mjs';

const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const event=(method,path,query)=>({rawPath:path,headers:{origin:'https://lesbuttes.com'},
 requestContext:{http:{method}},queryStringParameters:query});

test('production quote fails closed before its explicit read-only gate',async()=>{
 const handler=createProductionQuoteHandler({db:{send:async()=>{throw Error('must not read');}},
  env:{BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:table,PRODUCTION_QUOTE_ENABLED:'false'}});
 assert.equal((await handler(event('GET','/quote',{}))).statusCode,503);
});

test('production quote rejects foreign origins before reading the master',async()=>{
 const handler=createProductionQuoteHandler({db:{send:async()=>{throw Error('must not read');}},
  env:{BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:table,PRODUCTION_QUOTE_ENABLED:'true'}});
 const result=await handler({...event('GET','/quote',{}),headers:{origin:'https://example.invalid'}});
 assert.equal(result.statusCode,403);
});

test('production request endpoint is deployed but unconditionally disabled',async()=>{
 const old={BOOKING_ENVIRONMENT:process.env.BOOKING_ENVIRONMENT,BOOKINGS_TABLE:process.env.BOOKINGS_TABLE,
  BOOKING_REQUESTS_ENABLED:process.env.BOOKING_REQUESTS_ENABLED};
 Object.assign(process.env,{BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:table,BOOKING_REQUESTS_ENABLED:'false'});
 try{
  const result=await disabledRequest(event('POST','/request'));
  assert.equal(result.statusCode,503);
  assert.match(result.body,/not open yet/);
 }finally{
  for(const [key,value] of Object.entries(old))value===undefined?delete process.env[key]:process.env[key]=value;
 }
});
