import test from 'node:test';import assert from 'node:assert/strict';
import {publishOwnerConfiguration,rollbackOwnerConfiguration} from './booking-admin-config-writer.mjs';
const owner={role:'owner',subject:'owner-test'};
const value={depositPercent:25,balanceDueDays:56};
test('LB-06 owner publication uses immutable version and compare-and-swap',async()=>{
 let tx;
 const db={send:async cmd=>{tx=cmd.input;return {};}};
 await assert.rejects(publishOwnerConfiguration({db,table:'booking-staging',identity:{role:'viewer'},kind:'payments',value,expectedVersion:null,approved:true}),/Forbidden/);
 await assert.rejects(publishOwnerConfiguration({db,table:'booking-production',identity:owner,kind:'payments',value,expectedVersion:null,approved:true}),/Staging/);
 await assert.rejects(publishOwnerConfiguration({db,table:'booking-staging',identity:owner,kind:'payments',value,expectedVersion:null,approved:false}),/approval/);
 const result=await publishOwnerConfiguration({db,table:'booking-staging',identity:owner,kind:'payments',value,expectedVersion:null,approved:true});
 assert.match(result.version,/#[a-f0-9]{16}$/);
 assert.equal(tx.TransactItems.length,2);
 assert.equal(tx.TransactItems[0].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(tx.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(tx.TransactItems[0].Put.Item.approvedBy,'owner-test');
 await publishOwnerConfiguration({db,table:'booking-staging',identity:owner,kind:'payments',value,expectedVersion:'previous',approved:true});
 assert.equal(tx.TransactItems[1].Put.ExpressionAttributeValues[':expected'],'previous');
});
test('LB-06 rollback republishes historical value as new immutable version',async()=>{
 const db={send:async cmd=>{
  if(cmd.input.Key)return {Item:{kind:'payments',unit:'all',version:'old',value}};
  return {};
 }};
 const result=await rollbackOwnerConfiguration({db,table:'booking-staging',identity:owner,kind:'payments',historicalVersion:'old',expectedVersion:'current',approved:true});
 assert.notEqual(result.version,'old');
 await assert.rejects(rollbackOwnerConfiguration({db,table:'booking-staging',identity:{role:'viewer'},kind:'payments',historicalVersion:'old',expectedVersion:'current',approved:true}),/Forbidden/);
});
