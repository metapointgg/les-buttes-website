import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRealRequestDraft} from '../real-request-contract.mjs';
const terms={status:'PUBLISHED',version:3,digest:'a'.repeat(64)};
const request={unit:'geranium',start:'2027-07-10',end:'2027-07-17',
 adults:2,children:1,firstName:' Test ',lastName:'Guest',email:'TEST@example.com',
 telephone:'+44 7700 900123',notes:'Late arrival',acceptedTerms:true,
 acceptedCancellation:true,acceptedTermsVersion:3,acceptedTermsDigest:terms.digest};
test('real request contract only validates, normalises and requires current terms',()=>{
 const result=validateRealRequestDraft(request,terms);
 assert.equal(result.guestEmail,'test@example.com');
 assert.equal(result.guestName,'Test Guest');
 assert.equal(result.agreement.termsVersion,3);
 assert.equal(result.agreement.marketingConsent,false);
 assert.equal(result.guestTelephone,request.telephone);
});
test('missing, outdated or unapproved terms fail closed',()=>{
 for(const patch of [{acceptedTerms:false},{acceptedCancellation:false},{acceptedTermsVersion:2},
  {acceptedTermsDigest:'b'.repeat(64)}]){
  assert.throws(()=>validateRealRequestDraft({...request,...patch},terms),/accepted/);
 }
 for(const t of [null,{...terms,status:'DRAFT'},{...terms,digest:'invalid'}]){
  assert.throws(()=>validateRealRequestDraft(request,t),/Published terms unavailable/);
 }
});
test('marketing permission is independent and optional',()=>{
 assert.equal(validateRealRequestDraft({...request,marketingConsent:false},terms).agreement.marketingConsent,false);
 assert.equal(validateRealRequestDraft({...request,marketingConsent:true},terms).agreement.marketingConsent,true);
});
test('invalid contacts, excess guests, notes and dates fail closed',()=>{
 for(const patch of [{email:'invalid'},{telephone:'123'}, {adults:5},
  {notes:'x'.repeat(1001)},{start:'nope'},{unit:'unknown'}]){
  assert.throws(()=>validateRealRequestDraft({...request,...patch},terms));
 }
});
