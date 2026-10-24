import test from 'node:test';
import assert from 'node:assert/strict';
import {configKey,validateConfig,readSetting,publishSetting} from './booking-settings.mjs';
test('settings use the existing booking-master table key space',()=>{
 assert.deepEqual(configKey('pricing','geranium'),{PK:'CONFIG#pricing#geranium',SK:'CURRENT'});
 assert.throws(()=>configKey('pricing','outsider'));
});
test('validate cottage price and seasonal Saturday-to-Saturday restriction',()=>{
 assert.equal(validateConfig({kind:'pricing',unit:'geranium',value:{ranges:[{from:'2027-03-20',to:'2027-04-10',nightlyGBP:175}]}}),true);
 assert.equal(validateConfig({kind:'stay-rules',unit:'geranium',value:{ranges:[{from:'2027-03-20',to:'2027-04-10',minNights:7,maxNights:21,arrivalWeekdays:[6],departureWeekdays:[6]}]}}),true);
 assert.throws(()=>validateConfig({kind:'cancellation',value:{tiers:[{daysBeforeArrival:56,refundPercent:110}]}}));
});
test('reads strongly consistently from BOOKING_TABLE',async()=>{
 let seen;
 const db={send:async command=>{seen=command.input;return {Item:{version:'v1'}};}};
 assert.deepEqual(await readSetting(db,'test-master','payments'),{version:'v1'});
 assert.equal(seen.TableName,'test-master');
 assert.equal(seen.ConsistentRead,true);
});
test('publication requires approval and writes immutable history plus CAS current atomically',async()=>{
 let seen;
 const db={send:async command=>{seen=command.input;return {};}};
 const base={kind:'payments',value:{depositPercent:25,balanceDueDays:56},version:'2026-10-24T22:00:00.000Z#policy01',actor:'owner',approved:true};
 await assert.rejects(publishSetting(db,'master',{...base,approved:false}),/approval/);
 await publishSetting(db,'master',base);
 assert.equal(seen.TransactItems.length,2);
 assert.equal(seen.TransactItems[0].Put.TableName,'master');
 assert.equal(seen.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(PK)');
 await publishSetting(db,'master',{...base,expectedVersion:'old'});
 assert.equal(seen.TransactItems[1].Put.ConditionExpression,'#version = :expected');
});
