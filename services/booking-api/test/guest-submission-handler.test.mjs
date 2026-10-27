import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuestSubmissionHandler} from '../guest-submission-handler.mjs';

const bands=[{start:'2027-03-20',end:'2027-10-02',minNights:7,nightlyGBP:'100'}];
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{
 geranium:{version:1,value:{bands}},honeysuckle:{version:1,value:{bands}}}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const terms={status:'PUBLISHED',version:4,digest:'a'.repeat(64)};
const request={unit:'geranium',start:'2027-07-10',end:'2027-07-17',adults:2,children:0,
 firstName:'Synthetic',lastName:'Guest',email:'nobody@example.invalid',
 telephone:'0000000000',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:4,acceptedTermsDigest:terms.digest};
const origin='http://localhost:4321';
const event={httpMethod:'POST',path:'/real-booking-preflight',headers:{
 origin,'content-type':'application/json','idempotency-key':'synthetic-key-123456789',
 'cf-turnstile-response':'validated-only-server-side'},body:JSON.stringify(request)};
function make(verifyTurnstile=async()=>true){
 return createGuestSubmissionHandler({
  readAvailability:async()=>availability,readPricing:async()=>pricing,
  readTerms:async()=>terms,verifyTurnstile});
}
async function withFlags(fn){
 const keys=['BOOKING_ENVIRONMENT','BOOKING_REAL_GUEST_WRITES',
  'BOOKING_SUBMISSION_PREFLIGHT_ENABLED','BOOKING_ALLOWED_ORIGIN'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.BOOKING_ENVIRONMENT='staging';
  process.env.BOOKING_REAL_GUEST_WRITES='false';
  process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED='true';
  process.env.BOOKING_ALLOWED_ORIGIN=origin;
  await fn();
 }finally{
  for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
test('preflight endpoint is disabled by default, independent of event contents',async()=>{
 await withFlags(async()=>{
  process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED='false';
  assert.equal((await make()(event)).statusCode,403);
 });
});
test('protected handler quotes using trusted server providers but cannot submit',async()=>{
 await withFlags(async()=>{
  const result=await make()(event);
  assert.equal(result.statusCode,200);
  const body=JSON.parse(result.body);
  assert.equal(body.status,'PREFLIGHT_ONLY');
  assert.equal(body.submissionEnabled,false);
  assert.equal(body.totalGBP,700);
  assert.equal(JSON.stringify(body).includes('nobody@example.invalid'),false);
  assert.equal(JSON.stringify(body).includes('synthetic-key'),false);
 });
});
test('rejects wrong origin, invalid method, failed anti-bot and untrusted quote fields',async()=>{
 await withFlags(async()=>{
  assert.equal((await make()({...event,headers:{...event.headers,origin:'https://untrusted.example'}})).statusCode,403);
  assert.equal((await make()({...event,httpMethod:'GET'})).statusCode,404);
  assert.equal((await make(async()=>false)(event)).statusCode,400);
  assert.equal((await make()({...event,body:JSON.stringify({...request,totalGBP:1})})).statusCode,400);
  assert.equal((await createGuestSubmissionHandler()(event)).statusCode,503);
 });
});
