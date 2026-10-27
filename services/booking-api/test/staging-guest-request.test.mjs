import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingGuestRequest} from '../staging-guest-request.mjs';
const spans=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],['low','2027-09-25','2027-10-02',3]];
const pricing={cottages:Object.fromEntries([['geranium',155,3],['honeysuckle',140,1]].map(([unit,peak,version])=>[unit,{version,value:{bands:spans.map(([season,start,end,minNights])=>({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}}]))};
const availability={blocked:{geranium:[],honeysuckle:[]}};
const payload={unit:'both',start:'2027-07-10',end:'2027-07-17',adults:6,children:1,
 firstName:'Someone',lastName:'Example',email:'real-input@example.com',telephone:'+44 7700 900001',
 notes:'Private guest note',turnstileToken:'synthetic-valid-token'};
const origin='http://localhost:4321';
async function check(p,overrides={}){
 const writes=[];
 const params={payload:p,origin,ip:'127.0.0.1',verifyTurnstile:async()=>true,
  loadSnapshots:async()=>({availability,pricing}),writeHold:async hold=>writes.push(hold),...overrides};
 try{return {result:await createStagingGuestRequest(params),writes};}
 catch(error){return {error,writes};}
}
test('disabled without explicit staging flags',async()=>{
 const previous=process.env.BOOKING_STAGING_GUEST_WRITES;
 delete process.env.BOOKING_STAGING_GUEST_WRITES;
 const out=await check(payload);
 assert.match(out.error.message,/disabled/);
 assert.equal(out.writes.length,0);
 if(previous!==undefined)process.env.BOOKING_STAGING_GUEST_WRITES=previous;
});
test('verified synthetic request discards all guest input, including notes',async()=>{
 const env=process.env;
 const before=[env.BOOKING_ENVIRONMENT,env.BOOKING_STAGING_GUEST_WRITES,env.ALLOWED_PREVIEW_ORIGIN];
 env.BOOKING_ENVIRONMENT='staging';env.BOOKING_STAGING_GUEST_WRITES='true';env.ALLOWED_PREVIEW_ORIGIN=origin;
 try{
  const out=await check(payload);
  assert.equal(out.result.status,'REQUESTED');
  assert.equal(out.result.totalGBP,2065);
  assert.equal(out.writes.length,1);
  assert.equal(out.writes[0].items.length,15);
  const saved=JSON.stringify(out.writes[0]);
  assert.equal(saved.includes('real-input@example.com'),false);
  assert.equal(saved.includes('Private guest note'),false);
  assert.equal(saved.includes('Someone'),false);
  assert.equal(saved.includes('synthetic-valid-token'),false);
  assert.match(saved,/test@example.invalid/);
  for(const p of [{...payload,unit:'unknown'},{...payload,turnstileToken:''},{...payload,extra:'forbidden'}]){
   const fail=await check(p);
   assert.ok(fail.error);assert.equal(fail.writes.length,0);
  }
  const bot=await check(payload,{verifyTurnstile:async()=>false});
  assert.equal(bot.writes.length,0);
  const external=await check(payload,{origin:'https://www.lesbuttes.com'});
  assert.equal(external.writes.length,0);
 }finally{
  [env.BOOKING_ENVIRONMENT,env.BOOKING_STAGING_GUEST_WRITES,env.ALLOWED_PREVIEW_ORIGIN]=before;
 }
});
