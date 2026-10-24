import test from 'node:test';
import assert from 'node:assert/strict';
import {masterOccupied} from '../master-occupied.mjs';

test('read-only master selects UNIT DATE keys consistently, combines dates, and exports no identifiers',async()=>{
  const queries=[];
  const db={send:async command=>{
    const q=command.input;queries.push(q);
    assert.equal(q.ConsistentRead,true);
    assert.equal(q.ProjectionExpression,'PK, SK, expiresAt');
    assert.equal(q.KeyConditionExpression,'PK = :unit AND SK BETWEEN :start AND :end');
    assert.equal(q.ExpressionAttributeValues[':start'],'DATE#2027-03-20');
    assert.equal(q.ExpressionAttributeValues[':end'],'DATE#2027-10-01');
    if(q.ExpressionAttributeValues[':unit']==='UNIT#geranium'){
      if(!q.ExclusiveStartKey)return {Items:[
        {PK:'UNIT#geranium',SK:'DATE#2027-08-28',id:'PRIVATE-NOT-TO-BE-SENT'},
        {PK:'UNIT#geranium',SK:'DATE#2027-08-29'}
      ],LastEvaluatedKey:{PK:'UNIT#geranium',SK:'DATE#2027-08-29'}};
      return {Items:[
        {PK:'UNIT#geranium',SK:'DATE#2027-09-01'},
        {PK:'UNIT#geranium',SK:'DATE#2027-08-30'},
        {PK:'UNIT#geranium',SK:'DATE#2027-08-31'},
        {PK:'UNIT#geranium',SK:'DATE#2027-09-02',expiresAt:100}
      ]};
    }
    return {Items:[{PK:'UNIT#honeysuckle',SK:'DATE#2027-08-28'}]};
  }};
  const snapshot=await masterOccupied({db,table:'staging-test',nowEpoch:101,
    capturedAt:'2026-10-24T17:30:00.000Z'});
  assert.equal(snapshot.mode,'LIVE_STAGING_MASTER_READ_ONLY');
  assert.equal(queries.length,3);
  assert.deepEqual(snapshot.blocked.geranium,[{from:'2027-08-28',to:'2027-09-02'}]);
  assert.deepEqual(snapshot.blocked.honeysuckle,[{from:'2027-08-28',to:'2027-08-29'}]);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.ok(!JSON.stringify(snapshot).includes('bookingId'));
});
test('fail closed on unavailable master and unexpected date slots',async()=>{
  await assert.rejects(masterOccupied({db:null,table:'x'}),/not configured/);
  const bad={send:async()=>({Items:[{PK:'UNIT#geranium',SK:'DATE#2028-01-01'}]})};
  await assert.rejects(masterOccupied({db:bad,table:'x'}),/Unexpected date slot/);
});
