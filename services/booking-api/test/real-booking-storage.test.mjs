import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRealBookingStorage,buildEncryptedRealBookingItems} from '../real-booking-storage.mjs';
const terms={status:'PUBLISHED',version:2,digest:'a'.repeat(64)};
const request={unit:'honeysuckle',start:'2027-07-10',end:'2027-07-17',adults:2,children:1,
 firstName:'Alice',lastName:'Tester',email:'alice@example.org',telephone:'+44 7700 900123',
 notes:'Arriving late',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:2,acceptedTermsDigest:terms.digest};
const reference='123e4567-e89b-42d3-a456-426614174000';
test('metadata never holds guest names, contact details, notes or turnstile credentials',async()=>{
 const prepared=prepareRealBookingStorage({request,terms,requestKey:'booking-test-request-1234',reference});
 const original=JSON.stringify(prepared.publicMetadata);
 for(const secret of ['Alice','Tester','alice@example.org','7700','Arriving late']) assert.ok(!original.includes(secret));
 assert.equal(prepared.publicMetadata.acceptance.termsVersion,2);
 assert.equal(prepared.publicMetadata.synthetic,false);
 const items=await buildEncryptedRealBookingItems({prepared,tableName:'staging-test',retentionEpoch:Math.floor(Date.now()/1000)+3600,
  encrypt:async(plaintext,context)=>{
   assert.ok(plaintext.toString().includes('alice@example.org'));
   assert.equal(context.bookingId,reference);
   return Buffer.alloc(128,7);
  }});
 assert.equal(items.length,3);
 const storage=JSON.stringify(items);
 for(const secret of ['Alice','Tester','alice@example.org','7700','Arriving late'])assert.ok(!storage.includes(secret));
 assert.equal(items[1].Put.Item.PK,'GUEST#'+reference);
 assert.equal(items[2].Put.Item.SK,'REQUEST');
 assert.match(items[2].Put.ConditionExpression,/attribute_not_exists/);
});
test('same idempotency key gives same scope and another key differs',()=>{
 const prepare=key=>prepareRealBookingStorage({request,terms,requestKey:key,reference});
 assert.equal(prepare('booking-test-request-1234').scope,prepare('booking-test-request-1234').scope);
 assert.notEqual(prepare('booking-test-request-1234').scope,prepare('booking-test-request-5678').scope);
});
test('fail closed without approved terms, keys and functioning encryption',async()=>{
 assert.throws(()=>prepareRealBookingStorage({request,terms:{...terms,status:'DRAFT'},requestKey:'booking-test-request-1234',reference}));
 assert.throws(()=>prepareRealBookingStorage({request,terms,requestKey:'bad',reference}));
 const prepared=prepareRealBookingStorage({request,terms,requestKey:'booking-test-request-1234',reference});
 await assert.rejects(buildEncryptedRealBookingItems({prepared,tableName:'t',
  retentionEpoch:Math.floor(Date.now()/1000)+3600,encrypt:async()=>Buffer.alloc(0)}),/KMS encryption failed/);
});
