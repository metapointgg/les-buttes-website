import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePublishedBookingTerms} from '../cms-published-terms.mjs';
import {buildApprovedTermsRelease,readApprovedTermsFromMaster} from '../booking-terms-store.mjs';
import {readTurnstileSecret,TURNSTILE_PARAMETER} from '../booking-turnstile-secret.mjs';
import {createPrivatePreflightEntry} from '../guest-preflight-private-entry.mjs';

const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const source={status:'PUBLISHED',version:2,
 termsText:'Synthetic approved legal booking text for integration wiring tests only.',
 cancellationText:'Synthetic approved cancellation text for integration wiring tests only.'};
const digest=derivePublishedBookingTerms(source).digest;
const rows=buildApprovedTermsRelease({source,table,approvedDigest:digest}).transactWrite.TransactItems
 .map(x=>x.Put.Item);
const bands=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],
 ['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],
 ['low','2027-09-25','2027-10-02',3]].map(([season,start,end,minNights])=>
 ({season,start,end,minNights,nightlyGBP:'100'}));
const pricing=unit=>({PK:'CONFIG#pricing#'+unit,SK:'CURRENT',unit,version:1,
 value:{unit,year:2027,seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,bands}});
const db={send:async command=>{
 const input=command.input;
 if(input.Key?.PK==='CONFIG#booking-terms')return {Item:rows.find(x=>x.SK===input.Key.SK)};
 if(input.Key?.PK?.startsWith('CONFIG#pricing#'))
  return {Item:pricing(input.Key.PK.split('#').at(-1))};
 if(input.KeyConditionExpression)return {Items:[]};
 throw Error('Unexpected DynamoDB read');
}};
const headers={origin:'http://localhost:4321','content-type':'application/json',
 'cf-turnstile-response':'synthetic-turnstile-token',
 'idempotency-key':'synthetic-release-test-123456'};
const request={unit:'geranium',start:'2027-07-10',end:'2027-07-17',adults:2,children:0,
 firstName:'Synthetic',lastName:'Guest',email:'nobody@example.invalid',
 telephone:'0000000000',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:2,acceptedTermsDigest:digest};
test('private preflight integrates SSM secret, immutable CMS terms, master readers and Siteverify',async()=>{
 const keys=['BOOKING_ENVIRONMENT','BOOKING_REAL_GUEST_WRITES','BOOKING_SUBMISSION_PREFLIGHT_ENABLED','BOOKING_ALLOWED_ORIGIN'];
 const previous=Object.fromEntries(keys.map(x=>[x,process.env[x]]));
 try{
  Object.assign(process.env,{BOOKING_ENVIRONMENT:'staging',BOOKING_REAL_GUEST_WRITES:'false',
   BOOKING_SUBMISSION_PREFLIGHT_ENABLED:'true',BOOKING_ALLOWED_ORIGIN:'http://localhost:4321'});
  const terms=await readApprovedTermsFromMaster({db,table});
  const secret=await readTurnstileSecret({ssm:{send:async x=>({
   Parameter:{Type:'SecureString',Name:TURNSTILE_PARAMETER,Value:'synthetic-secret-for-testing'}
  })}});
  const handler=createPrivatePreflightEntry({db,table,hostname:'localhost',
   readPublishedTerms:async()=>terms,turnstileSecret:secret,
   siteverify:async x=>({success:x.secret===secret,hostname:'localhost',action:'booking_preflight'})});
  const result=await handler({httpMethod:'POST',path:'/real-booking-preflight',
   headers,body:JSON.stringify(request)});
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).totalGBP,700);
  assert.equal(JSON.parse(result.body).submissionEnabled,false);
  assert.equal(result.body.includes('synthetic-secret'),false);
  assert.equal(result.body.includes('nobody@example.invalid'),false);
  await assert.rejects(readApprovedTermsFromMaster({db:{send:async()=>({Item:undefined})},table}));
 }finally{
  for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
