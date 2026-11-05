import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handler} from './staging-payment-route-handler.mjs';

const route='POST /admin/bookings/{bookingId}/payment/reconcile';
const path='/admin/bookings/12345678-1234-1234-1234-123456789abc/payment/reconcile';
const event=(overrides={})=>({
  rawPath:path,
  requestContext:{http:{method:'POST'},routeKey:route},
  ...overrides
});

test('payment-only entrypoint refuses requests without verified gateway JWT',async()=>{
  const response=await handler(event());
  assert.equal(response.statusCode,403);
});
test('payment-only entrypoint refuses other paths before invoking admin runtime',async()=>{
  const response=await handler(event({rawPath:'/admin/bookings'}));
  assert.equal(response.statusCode,404);
});
test('payment-only entrypoint refuses other gateway route keys',async()=>{
  const response=await handler(event({requestContext:{http:{method:'POST'},routeKey:'ANY /{proxy+}'}}));
  assert.equal(response.statusCode,403);
});
test('payment-only entrypoint refuses GET even with a matching path',async()=>{
  const response=await handler(event({requestContext:{http:{method:'GET'},routeKey:route}}));
  assert.equal(response.statusCode,404);
});
test('review template points only to route-isolated Lambda entrypoint',()=>{
  const yaml=readFileSync(new URL('./staging-canonical-payment-route-review.template.yaml',import.meta.url),'utf8');
  assert.match(yaml,/Handler: staging-payment-route-handler\.handler/);
});

test('payment-only entrypoint rejects malformed booking identifiers',async()=>{
  for(const identifier of ['not-a-booking','12345678-1234-1234-1234-123456789abz','00000000-0000-0000-0000-000000000000/extra']){
    const response=await handler(event({rawPath:`/admin/bookings/${identifier}/payment/reconcile`}));
    assert.equal(response.statusCode,404,identifier);
  }
});
test('payment-only entrypoint never exposes credentials or allows caching in denied responses',async()=>{
  const response=await handler(event());
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.deepEqual(JSON.parse(response.body),{error:'Forbidden'});
});
