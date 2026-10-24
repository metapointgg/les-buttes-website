// Runs ONLY against a dedicated AWS booking staging stack with private staging token.
// No real guests, emails, payment links, or bookings.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const url=process.env.BOOKING_API_URL?.replace(/\/+$/,'');
const secret=process.env.STAGING_API_TOKEN;
if(!url||!secret||secret.length<24||process.env.BOOKING_ENVIRONMENT!=='staging'||
    !process.env.BOOKINGS_TABLE?.toLowerCase().includes('staging')){
  console.error('Requires BOOKING_API_URL, STAGING_API_TOKEN, BOOKING_ENVIRONMENT=staging and a staging-named BOOKINGS_TABLE');
  process.exit(1);
}
if(!/^https:\/\/[a-z0-9.-]+\.amazonaws\.com$/.test(url)&&!/^https:\/\/[a-z0-9.-]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(url)){
  console.error('Refusing a non-AWS test API endpoint');
  process.exit(1);
}
const headers={'x-lesbuttes-staging-token':secret};
let start=process.env.STAGING_CHECKIN||null;
let end=process.env.STAGING_CHECKOUT||null;
if(Boolean(start)!==Boolean(end))throw Error('STAGING_CHECKIN and STAGING_CHECKOUT must both be supplied together');
const unit=process.env.STAGING_COTTAGE??'geranium';
if(!['geranium','honeysuckle','both'].includes(unit))throw Error('Invalid unit');
const guests=2;
let bookingId=null;
const admin=(...args)=>execFileSync(process.execPath,[join(here,'admin.mjs'),...args],{env:process.env,encoding:'utf8'});
async function req(path,options={}){
  const res=await fetch(url+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000),cache:'no-store'});
  const body=await res.text();
  let data;try{data=JSON.parse(body);}catch{data=body;}
  return {status:res.status,data};
}
// Test dates must be vacant in BOTH cottages because the rehearsal also verifies
// that a rejected combined-cottage request never creates an orphan hold.
// Staging now contains verified Airbnb reservations, so never reuse fixed dates blindly.
const candidateDates=start&&end?[[start,end]]:[
  ['2027-06-01','2027-06-06'],
  ['2027-06-06','2027-06-11'],
  ['2027-06-26','2027-07-01'],
  ['2027-04-10','2027-04-15'],
  ['2027-05-01','2027-05-06'],
  ['2027-09-06','2027-09-11']
];
try{
  const health=await req('/health');
  assert.equal(health.status,200,'Staging health endpoint');
  assert.equal(health.data.acceptingRequests,true,'Staging API must be enabled');
  let found=false;
  for(const [candidateStart,candidateEnd] of candidateDates){
    const probe='/availability?'+new URLSearchParams({unit:'both',start:candidateStart,end:candidateEnd,guests:String(guests)});
    const availableBoth=await req(probe);
    if(availableBoth.status===200&&availableBoth.data.available){
      start=candidateStart;end=candidateEnd;found=true;break;
    }
  }
  assert.equal(found,true,'No vacant synthetic test dates in both cottages. Provide STAGING_CHECKIN/STAGING_CHECKOUT after checking real Airbnb blocks.');
  console.log('Staging synthetic test interval: '+start+' to '+end+' (both cottages vacant before test).');
  const search='/availability?'+new URLSearchParams({unit,start,end,guests:String(guests)});
  const request={unit,start,end,guests,name:'Staging Test Guest',email:'test@example.invalid',notes:'Synthetic test, never a guest booking',consent:true,turnstileToken:'XXXX.DUMMY.TOKEN.XXXX',website:''};
  const before=await req(search);
  assert.equal(before.status,200,'Availability must have staged approved test rates and minimum stays');
  assert.equal(before.data.available,true,'Choose a fresh unused interval in STAGING_CHECKIN / STAGING_CHECKOUT');
  assert.ok(Number(before.data.quote.totalGBP)>0,'Staged GBP quote');

  const send=()=>req('/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  const first=await send();
  assert.equal(first.status,202,'First synthetic booking accepted');
  bookingId=first.data.reference;
  assert.match(bookingId,/^[0-9a-f-]{36}$/);

  const unavailable=await req(search);
  assert.equal(unavailable.status,200);
  assert.equal(unavailable.data.available,false,'Hold blocks direct availability');
  const conflict=await send();
  assert.equal(conflict.status,409,'Second request for same dates is refused');
  if(unit!=='both'){
    const other=unit==='geranium'?'honeysuckle':'geranium';
    const otherSearch='/availability?'+new URLSearchParams({unit:other,start,end,guests:String(guests)});
    const otherBefore=await req(otherSearch);
    assert.equal(otherBefore.data.available,true,'Other cottage remains independently available');
    const combined={...request,unit:'both'};
    const combinedConflict=await req('/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(combined)});
    assert.equal(combinedConflict.status,409,'Both-cottage request must fail when one cottage is held');
    const otherAfter=await req(otherSearch);
    assert.equal(otherAfter.data.available,true,'Failed combined request must NOT leave an orphan hold on the other cottage');
  }
  const end28=new Date(Date.parse(start+'T00:00:00Z')+28*86400000).toISOString().slice(0,10);
  const tooLong=await req('/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,end:end28})});
  assert.equal(tooLong.status,400,'28-night requests must be rejected by the API');
  // No SumUp URL is contacted; host CLI accepts test.invalid only in staging.
  const approval=admin('approve',bookingId,before.data.quote.totalGBP,'https://test.invalid/not-a-payment');
  assert.match(approval,/Approved/);
  const confirmed=admin('confirm',bookingId,'TEST-NO-PAYMENT');
  assert.match(confirmed,/Confirmed/);
  const stillUnavailable=await req(search);
  assert.equal(stillUnavailable.data.available,false,'Confirmed booking stays blocked');

  const canceled=admin('cancel',bookingId,'Staging only end-to-end test cleanup');
  bookingId=null;
  assert.match(canceled,/cancelled/i);
  const again=await req(search);
  assert.equal(again.data.available,true,'Cancel releases the held nights');
  console.log('STAGING PASS: quote -> request -> conflict rejection -> approval -> synthetic confirmation -> cancellation -> availability.');
  console.log('No SumUp payment, real guest email, or production booking was created.');
}catch(error){
  console.error('STAGING FAILED: '+error.message);
  if(bookingId){
    console.error('SAFETY: Synthetic booking '+bookingId+' remains in staging. Do not reuse these test dates until manually reconciled.');
    console.error('Use node admin.mjs show '+bookingId+' and cancel/decline according to its state.');
  }
  process.exitCode=1;
}
