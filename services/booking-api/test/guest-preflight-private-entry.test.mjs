import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../guest-preflight-private-entry.mjs';
test('private preflight entry rejects invocation before making AWS requests',async()=>{
 const original=process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED;
 try{
  process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED='false';
  const result=await handler({httpMethod:'POST',path:'/real-booking-preflight',body:'{}'});
  assert.equal(result.statusCode,403);
 }finally{
  if(original===undefined)delete process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED;
  else process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED=original;
 }
});
