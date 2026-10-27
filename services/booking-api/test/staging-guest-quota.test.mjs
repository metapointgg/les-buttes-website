import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticQuotaItems} from '../staging-guest-quota.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const values={table,ip:'127.0.0.1',secret:'not-a-real-test-secret',nowEpoch:1800000000};
test('two hourly counter updates enforce global 20 and per-source 3 atomically',()=>{
 const items=syntheticQuotaItems(values);
 assert.equal(items.length,2);
 assert.deepEqual(items.map(x=>x.Update.ExpressionAttributeValues[':limit']),[20,3]);
 assert.equal(items[0].Update.Key.SK,'GLOBAL');
 assert.match(items[1].Update.Key.SK,/^SOURCE#[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify(items).includes('127.0.0.1'));
 for(const item of items){
  assert.equal(item.Update.TableName,table);
  assert.match(item.Update.ConditionExpression,/#count < :limit/);
  assert.match(item.Update.UpdateExpression,/ADD #count :one/);
  assert.ok(item.Update.ExpressionAttributeValues[':expiry']>values.nowEpoch);
 }
});
test('same source in one hour has stable key; new hour changes key',()=>{
 const a=syntheticQuotaItems(values);
 const b=syntheticQuotaItems({...values,nowEpoch:values.nowEpoch+20});
 const c=syntheticQuotaItems({...values,nowEpoch:values.nowEpoch+3600});
 assert.deepEqual(a,b);
 assert.notEqual(a[0].Update.Key.PK,c[0].Update.Key.PK);
});
test('rejects untrusted source identity and other tables without quota writes',()=>{
 for(const options of [{table:'production'}, {ip:''},{ip:'spoofed-ip'}, {secret:''}]){
  assert.throws(()=>syntheticQuotaItems({...values,...options}));
 }
});
