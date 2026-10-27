import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../private-integration-handler.mjs';

test('private Lambda refuses every invocation with integration flag disabled',async()=>{
 const old=process.env.BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED;
 const prior=process.env.BOOKING_ENVIRONMENT;
 try{
  process.env.BOOKING_ENVIRONMENT='staging';
  process.env.BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED='false';
  for(const request of [{operation:'SYNTHETIC_PRIVATE_INTEGRATION_TEST'}, {}, null,
   {operation:'SYNTHETIC_PRIVATE_INTEGRATION_TEST',email:'someone@example.org'}]){
   const result=await handler(request);
   assert.equal(result.statusCode,403);
   assert.equal(JSON.parse(result.body).message,'Private test disabled');
  }
 }finally{
  if(old===undefined)delete process.env.BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED;
  else process.env.BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED=old;
  if(prior===undefined)delete process.env.BOOKING_ENVIRONMENT;
  else process.env.BOOKING_ENVIRONMENT=prior;
 }
});
