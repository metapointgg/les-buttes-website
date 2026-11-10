import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from './staging-owner-action-route-handler.mjs';
const id='11111111-1111-4111-8111-111111111111';
const route='POST /admin/bookings/{bookingId}/actions/{action}';
const event={rawPath:'/admin/bookings/'+id+'/actions/decline',
 requestContext:{http:{method:'POST'},routeKey:route}};
test('canonical owner-action entrypoint rejects unrelated routes and missing verified JWT',async()=>{
 assert.equal((await handler({...event,rawPath:'/admin/bookings/'+id+'/payment/reconcile'})).statusCode,404);
 assert.equal((await handler({...event,requestContext:{...event.requestContext,routeKey:'ANY /{proxy+}'}})).statusCode,403);
 assert.equal((await handler(event)).statusCode,403);
});
test('canonical owner-action entrypoint rejects non-staging table before any write',async()=>{
 const prior={environment:process.env.BOOKING_ENVIRONMENT,table:process.env.BOOKINGS_TABLE};
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='les-buttes-booking-production-BookingTable-ABC';
 try{
  const response=await handler({...event,requestContext:{...event.requestContext,
   authorizer:{jwt:{claims:{sub:'synthetic'}}}}});
  assert.equal(response.statusCode,503);
 }finally{
  if(prior.environment===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=prior.environment;
  if(prior.table===undefined)delete process.env.BOOKINGS_TABLE;
  else process.env.BOOKINGS_TABLE=prior.table;
 }
});
