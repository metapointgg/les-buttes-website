import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGuestPreflightProviders} from '../guest-preflight-providers.mjs';

const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const unit='geranium';
const config=u=>({PK:'CONFIG#pricing#'+u,SK:'CURRENT',unit:u,version:1,
 value:{unit:u,year:2027,seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,
 bands:[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],
 ['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],
 ['low','2027-09-25','2027-10-02',3]].map(([season,start,end,minNights])=>
 ({season,start,end,minNights,nightlyGBP:'100'}))}});
const calls=[];
const db={send:async command=>{
 calls.push(command.constructor.name);
 if(command.input.Key)return {Item:config(command.input.Key.PK.split('#').pop())};
 return {Items:[]};
}};
const make=(extra={})=>makeGuestPreflightProviders({db,table,
 siteverify:async()=>({success:true,hostname:'localhost',action:'booking_preflight'}),
 turnstileSecret:'synthetic-test-secret',expectedHostname:'localhost',...extra});
test('uses DynamoDB query/get adapters for authoritative availability and pricing',async()=>{
 const providers=make();
 const availability=await providers.readAvailability();
 const pricing=await providers.readPricing();
 assert.equal(availability.mode,'LIVE_STAGING_MASTER_READ_ONLY');
 assert.deepEqual(availability.blocked,{geranium:[],honeysuckle:[]});
 assert.equal(pricing.cottages[unit].value.bands.length,5);
 assert.equal(calls.filter(x=>x==='QueryCommand').length,2);
 assert.equal(calls.filter(x=>x==='GetCommand').length,2);
});
test('requires CMS-published terms and validates exact version/digest',async()=>{
 await assert.rejects(make().readTerms(),/Published CMS terms unavailable/);
 const p=make({readPublishedTerms:async()=>({status:'PUBLISHED',version:7,digest:'a'.repeat(64)})});
 assert.equal((await p.readTerms()).version,7);
 await assert.rejects(make({readPublishedTerms:async()=>({status:'DRAFT',version:7,digest:'a'.repeat(64)})}).readTerms());
});
test('Turnstile acceptance requires server-side success and exact hostname and action',async()=>{
 assert.equal(await make().verifyTurnstile('synthetic-token'),true);
 for(const outcome of [{success:false,hostname:'localhost',action:'booking_preflight'},
  {success:true,hostname:'elsewhere.com',action:'booking_preflight'},
  {success:true,hostname:'localhost',action:'other'}]){
  assert.equal(await make({siteverify:async()=>outcome}).verifyTurnstile('synthetic-token'),false);
 }
 assert.equal(await make({turnstileSecret:''}).verifyTurnstile('synthetic-token'),false);
 assert.equal(await make({siteverify:async()=>{throw Error('failed')}}).verifyTurnstile('synthetic-token'),false);
});
test('rejects non-staging tables',()=>{
 assert.throws(()=>makeGuestPreflightProviders({db,table:'production'}),/staging reader/);
});
