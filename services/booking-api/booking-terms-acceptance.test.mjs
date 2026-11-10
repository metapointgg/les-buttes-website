import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTermsAcceptance} from './booking-terms-acceptance.mjs';

const record={PK:'CONFIG#terms#all',SK:'CURRENT',value:{termsVersion:'LB-DIRECT-2027-01',
 privacyVersion:'LB-PRIVACY-2027-01',contentSha256:'b'.repeat(64)}};
const acceptance={accepted:true,termsVersion:'LB-DIRECT-2027-01',privacyVersion:'LB-PRIVACY-2027-01'};

test('records immutable evidence for the exact published terms accepted by the guest',()=>{
 assert.deepEqual(validateTermsAcceptance({acceptance,termsRecord:record,now:new Date('2026-11-10T12:00:00Z')}),{
  termsVersion:'LB-DIRECT-2027-01',privacyVersion:'LB-PRIVACY-2027-01',
  termsContentSha256:'b'.repeat(64),termsAcceptedAt:'2026-11-10T12:00:00.000Z'});
});

test('fails closed for absent, stale or mismatched terms evidence',()=>{
 assert.throws(()=>validateTermsAcceptance({acceptance:null,termsRecord:record}),/acceptance required/);
 assert.throws(()=>validateTermsAcceptance({acceptance:{...acceptance,termsVersion:'old'},termsRecord:record}),/acceptance required/);
 assert.throws(()=>validateTermsAcceptance({acceptance,termsRecord:{...record,value:{...record.value,contentSha256:'bad'}}}),/unavailable/);
});
