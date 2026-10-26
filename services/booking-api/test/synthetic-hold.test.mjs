import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSyntheticHold,submitSyntheticHold} from '../synthetic-hold.mjs';
const spans=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],['low','2027-09-25','2027-10-02',3]];
const c=(peak,v)=>({version:v,value:{bands:spans.map(([season,start,end,minNights])=>({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}});
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{geranium:c(155,3),honeysuckle:c(140,1)}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const args={availability,pricing,unit:'both',start:'2027-07-10',end:'2027-07-17',adults:6,children:1,nowEpoch:1800000000,id:'11111111-1111-4111-8111-111111111111'};
test('synthetic hold writes metadata and both cottage nightly slots atomically',()=>{
 const x=buildSyntheticHold(args);
 assert.equal(x.items.length,15);
 assert.equal(x.quote.totalGBP,2065);
 assert.equal(x.meta.guestEmail,'test@example.invalid');
 assert.equal(x.meta.status,'REQUESTED');
 assert.equal(x.meta.synthetic,true);
 assert.equal(x.meta.holdExpiresAt,args.nowEpoch+86400);
 assert.equal(x.items[0].Put.Item.PK,'BOOKING#'+args.id);
 for(const row of x.items.slice(1)){
  assert.equal(row.Put.Item.expiresAt,x.meta.holdExpiresAt);
  assert.match(row.Put.ConditionExpression,/attribute_not_exists\(PK\)/);
  assert.match(row.Put.ConditionExpression,/attribute_exists\(expiresAt\)/);
 }
});
test('staging submit uses a single conditional transaction, and never runs for other tables',async()=>{
 const writes=[];
 const db={send:async x=>{writes.push(x);return {}}};
 const result=await submitSyntheticHold({db,table:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',...args});
 assert.equal(result.reference,args.id);
 assert.equal(writes.length,1);
 assert.equal(writes[0].TransactItems.length,15);
 assert.equal(writes[0].TransactItems[0].Put.TableName,'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK');
 await assert.rejects(submitSyntheticHold({db,table:'production',...args}),/Staging table required/);
 assert.equal(writes.length,1);
});
test('occupied dates refuse a synthetic hold before any database write',async()=>{
 const db={send:async()=>{throw Error('unexpected write')}};
 await assert.rejects(submitSyntheticHold({db,table:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',...args,availability:{...availability,blocked:{geranium:[{from:'2027-07-11',to:'2027-07-12'}],honeysuckle:[]}}}),/occupied/i);
});
