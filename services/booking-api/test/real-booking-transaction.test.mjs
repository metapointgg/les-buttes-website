import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRealBookingStorage} from '../real-booking-storage.mjs';
import {planRealBookingTransaction} from '../real-booking-transaction.mjs';
const spans=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],
 ['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],['low','2027-09-25','2027-10-02',3]];
const rates=(peak,version)=>({version,value:{bands:spans.map(([season,start,end,minNights])=>
 ({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}});
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{geranium:rates(155,3),honeysuckle:rates(140,1)}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const terms={status:'PUBLISHED',version:2,digest:'a'.repeat(64)};
const request={unit:'both',start:'2027-07-10',end:'2027-07-17',adults:6,children:1,
 firstName:'Alice',lastName:'Tester',email:'alice@example.org',telephone:'+44 7700 900123',
 notes:'Arriving late',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:2,acceptedTermsDigest:terms.digest};
const reference='123e4567-e89b-42d3-a456-426614174000';
const tableName='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const prepared=()=>prepareRealBookingStorage({request,terms,requestKey:'booking-test-request-1234',reference,
 now:new Date('2026-10-27T16:00:00.000Z')});
const args=()=>({prepared:prepared(),availability,pricing,tableName,nowEpoch:1793116800,
 encrypt:async()=>Buffer.alloc(128,3)});
test('dry-run creates 17 atomic conditional puts for both cottages without contact plaintext',async()=>{
 const old=process.env.BOOKING_ENVIRONMENT;
 process.env.BOOKING_ENVIRONMENT='staging';
 try{
  const plan=await planRealBookingTransaction(args());
  assert.equal(plan.mode,'DRY_RUN_ONLY');
  assert.equal(plan.totalGBP,2065);
  assert.equal(plan.slotCount,14);
  assert.equal(plan.transactWrite.TransactItems.length,17);
  assert.equal(plan.transactWrite.ClientRequestToken,reference);
  for(const item of plan.transactWrite.TransactItems)assert.match(item.Put.ConditionExpression,/attribute_not_exists/);
  for(const item of plan.transactWrite.TransactItems.slice(3))
   assert.match(item.Put.ConditionExpression,/expiresAt < :now/);
  const serialized=JSON.stringify(plan);
  for(const secret of ['alice@example.org','Arriving late','+44 7700','Alice Tester'])
   assert.ok(!serialized.includes(secret));
  assert.equal(plan.transactWrite.TransactItems[0].Put.Item.GSI1PK,'BOOKING_REQUESTS');
 }finally{if(old===undefined)delete process.env.BOOKING_ENVIRONMENT;else process.env.BOOKING_ENVIRONMENT=old;}
});
test('stale or occupied availability fails before encryption',async()=>{
 const previous=process.env.BOOKING_ENVIRONMENT;
 process.env.BOOKING_ENVIRONMENT='staging';
 try{
  let called=false;
  const encrypt=async()=>{called=true;return Buffer.alloc(128,3)};
  await assert.rejects(planRealBookingTransaction({...args(),encrypt,
   availability:{...availability,blocked:{geranium:[{from:'2027-07-10',to:'2027-07-11'}],honeysuckle:[]}}}),/Dates occupied/);
  assert.equal(called,false);
  await assert.rejects(planRealBookingTransaction({...args(),encrypt,
   pricing:{...pricing,mode:'UNPUBLISHED'}}),/Master or published prices unavailable/);
 }finally{if(previous===undefined)delete process.env.BOOKING_ENVIRONMENT;else process.env.BOOKING_ENVIRONMENT=previous;}
});
test('disabled environment and production table are rejected',async()=>{
 await assert.rejects(planRealBookingTransaction({...args(),tableName:'production'}),/Staging booking master/);
 const old=process.env.BOOKING_REAL_GUEST_WRITES,prior=process.env.BOOKING_ENVIRONMENT;
 process.env.BOOKING_REAL_GUEST_WRITES='true';process.env.BOOKING_ENVIRONMENT='staging';
 try{await assert.rejects(planRealBookingTransaction(args()),/must remain disabled/)}
 finally{if(old===undefined)delete process.env.BOOKING_REAL_GUEST_WRITES;else process.env.BOOKING_REAL_GUEST_WRITES=old;
 if(prior===undefined)delete process.env.BOOKING_ENVIRONMENT;else process.env.BOOKING_ENVIRONMENT=prior;}
});
