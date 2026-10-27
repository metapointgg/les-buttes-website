import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightGuestSubmission} from '../guest-submission-preflight.mjs';
const terms={status:'PUBLISHED',version:4,digest:'a'.repeat(64)};
const bands=[{start:'2027-03-20',end:'2027-10-02',minNights:7,nightlyGBP:'100'}];
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{
 geranium:{version:1,value:{bands}},honeysuckle:{version:1,value:{bands}}}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const request={unit:'geranium',start:'2027-07-10',end:'2027-07-17',
 adults:2,children:1,firstName:'Synthetic',lastName:'Guest',
 email:'nobody@example.invalid',telephone:'0000000000',notes:'test',
 acceptedTerms:true,acceptedCancellation:true,acceptedTermsVersion:4,
 acceptedTermsDigest:terms.digest};
const args={body:JSON.stringify(request),terms,pricing,availability,
 requestKey:'synthetic-key-123456789',turnstileVerified:true};
test('preflight returns verified quote, no write action',()=>{
 const x=preflightGuestSubmission(args);
 assert.equal(x.mode,'PREFLIGHT_ONLY');
 assert.equal(x.safeSummary.totalGBP,700);
 assert.equal(x.quote.status,'STAGING_VERIFIED_READ_ONLY');
 assert.equal(x.transactWrite,undefined);
 assert.equal(x.scope.length,64);
});
test('rejects unverified requests, body tampering and injected prices',()=>{
 for(const patch of [{turnstileVerified:false},{requestKey:'tiny'},
  {contentType:'text/plain'}, {body:'{bad'}, {body:' '.repeat(8193)},
  {body:JSON.stringify({...request,totalGBP:1})},
  {body:JSON.stringify({...request,acceptedTermsDigest:'b'.repeat(64)})},
  {availability:{...availability,blocked:{geranium:[{from:'2027-07-10',to:'2027-07-17'}],honeysuckle:[]}}},
  {pricing:{...pricing,mode:'UNPUBLISHED'}}])
  assert.throws(()=>preflightGuestSubmission({...args,...patch}));
});
test('same request key binds independently to submission content',()=>{
 const a=preflightGuestSubmission(args);
 const b=preflightGuestSubmission({...args,body:JSON.stringify({...request,notes:'changed'})});
 assert.equal(a.scope,b.scope);
 assert.notEqual(a.payloadFingerprint,b.payloadFingerprint);
});
