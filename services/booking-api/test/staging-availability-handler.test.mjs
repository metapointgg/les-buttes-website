import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingAvailabilityHandler} from '../staging-availability-handler.mjs';

const table='les-buttes-booking-staging-BookingTable-Test123';
const event={requestContext:{http:{method:'GET'},authorizer:{lambda:{bookingStagingReviewer:true}}},rawPath:'/api/staging/availability'};
const make=(options={})=>{
  const db={send:async command=>{
    const unit=command.input.ExpressionAttributeValues[':unit'];
    return {Items:unit==='UNIT#geranium'?[{SK:'DATE#2027-08-28'}]:[{SK:'DATE#2027-08-28'}]};
  }};
  return createStagingAvailabilityHandler({
    db,table,environment:'staging',
    authorised:e=>e.requestContext?.authorizer?.lambda?.bookingStagingReviewer===true,
    ...options
  });
};

test('denies requests without trusted reviewer authorizer context',async()=>{
  const handler=make();
  for(const request of [{}, {rawPath:event.rawPath,requestContext:{http:{method:'GET'}}},
    {...event,requestContext:{...event.requestContext,authorizer:{lambda:{bookingStagingReviewer:'true'}}}}]){
    const response=await handler(request);
    assert.equal(response.statusCode,403);
  }
});
test('denies unsupported methods and paths',async()=>{
  const handler=make();
  assert.equal((await handler({...event,requestContext:{...event.requestContext,http:{method:'POST'}}})).statusCode,404);
  assert.equal((await handler({...event,rawPath:'/requests'})).statusCode,404);
});
test('rejects non-staging environment and unexpected table',async()=>{
  assert.equal((await make({environment:'production'})(event)).statusCode,503);
  assert.equal((await make({table:'other-table'})(event)).statusCode,503);
});
test('returns fresh occupied dates only, with no booking metadata',async()=>{
  const response=await make()(event);
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['Cache-Control'],'no-store, max-age=0');
  const body=JSON.parse(response.body);
  assert.equal(body.mode,'LIVE_STAGING_MASTER_READ_ONLY');
  assert.deepEqual(body.blocked.geranium,[{from:'2027-08-28',to:'2027-08-29'}]);
  assert.deepEqual(body.blocked.honeysuckle,[{from:'2027-08-28',to:'2027-08-29'}]);
  assert.equal(body.lastCheckout,'2027-10-02');
  assert.ok(Date.now()-Date.parse(body.capturedAt)<120000);
  assert.doesNotMatch(response.body,/guestName|guestEmail|paymentReference|bookingId/i);
});
test('fails closed on database error',async()=>{
  const handler=make({db:{send:async()=>{throw Error('DynamoDB unavailable');}}});
  const response=await handler(event);
  assert.equal(response.statusCode,503);
  assert.equal(JSON.parse(response.body).error,'Availability unavailable');
});

test('reads all DynamoDB pages and combines adjacent occupied nights',async()=>{
  const calls=[];
  const db={send:async command=>{
    const input=command.input;
    calls.push(input);
    assert.equal(input.ConsistentRead,true);
    assert.equal(input.ProjectionExpression,'PK, SK, expiresAt');
    const unit=input.ExpressionAttributeValues[':unit'];
    if(unit==='UNIT#honeysuckle')return {Items:[]};
    if(!input.ExclusiveStartKey)return {
      Items:[{SK:'DATE#2027-08-28'}],LastEvaluatedKey:{PK:unit,SK:'DATE#2027-08-28'}
    };
    return {Items:[{SK:'DATE#2027-08-29'}]};
  }};
  const response=await make({db})(event);
  assert.equal(response.statusCode,200);
  const data=JSON.parse(response.body);
  assert.deepEqual(data.blocked.geranium,[{from:'2027-08-28',to:'2027-08-30'}]);
  assert.deepEqual(data.blocked.honeysuckle,[]);
  assert.equal(calls.length,3);
});

test('ignores expired slots instead of incorrectly blocking dates',async()=>{
  const db={send:async()=>({Items:[{SK:'DATE#2027-08-28',expiresAt:1}]})};
  const response=await make({db})(event);
  assert.equal(response.statusCode,200);
  const data=JSON.parse(response.body);
  assert.deepEqual(data.blocked.geranium,[]);
  assert.deepEqual(data.blocked.honeysuckle,[]);
});
