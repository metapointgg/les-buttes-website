import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {saveAirbnbSnapshot,requireAirbnbAvailability,validateAirbnbSnapshot} from './airbnb-availability.mjs';
import {parseAirbnbCalendar} from './preview-airbnb.mjs';
const selection={unit:'honeysuckle',start:'2027-05-08',end:'2027-05-15',now:1000};
const base={PK:'UNIT#honeysuckle',SK:'AIRBNB#CURRENT',source:'airbnb-calendar',status:'VERIFIED',version:'v1',checkedAt:990,validUntil:2790,from:'2027-03-20',to:'2027-10-02',blockedNights:[]};
test('unverified, stale, incomplete and foreign snapshots fail closed',()=>{
 for(const row of [null,{...base,status:'UNVERIFIED'},{...base,validUntil:999},{...base,from:undefined},{...base,to:'2027-05-09'},{...base,PK:'UNIT#geranium'}])assert.throws(()=>validateAirbnbSnapshot(row,selection),/unverified/);
 assert.equal(validateAirbnbSnapshot(base,selection),base);
});
test('Airbnb overlap blocks selection, checkout remains exclusive, atomic snapshot check returned',async()=>{
 const db={send:async()=>({Item:{...base,blockedNights:['2027-05-15']}})};
 const args={db,table:'staging',units:['honeysuckle'],...selection};
 const checks=await requireAirbnbAvailability(args);
 assert.equal(checks[0].ConditionCheck.ExpressionAttributeValues[':version'],'v1');
 db.send=async()=>({Item:{...base,blockedNights:['2027-05-14']}});
 await assert.rejects(requireAirbnbAvailability(args),/dates unavailable/);
});
test('changed and cancelled feeds replace only their snapshot; direct reservation keys untouched',async()=>{
 const writes=[];const db={send:async c=>writes.push(c.input)};
 for(const blockedNights of [['2027-05-08','2027-05-09'],['2027-05-10'],[]])await saveAirbnbSnapshot({db,table:'staging',unit:'honeysuckle',blockedNights,from:'2027-03-20',to:'2027-10-02',startedAt:1000+writes.length});
 assert.ok(writes.every(w=>w.Item.SK==='AIRBNB#CURRENT'&&w.ConditionExpression.includes('checkedAt <')));
 assert.deepEqual(writes[2].Item.blockedNights,[]);
 assert.equal(new Set(writes.map(w=>w.Item.version)).size,3);
});
test('truncated feed is rejected rather than interpreted as cancelled reservations',()=>{
 assert.throws(()=>parseAirbnbCalendar('BEGIN:VCALENDAR\n'),/Unclosed/);
});

test('production request writer checks Airbnb snapshots atomically before reserving a cottage',()=>{
  const source=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
  assert.match(source,/import \{requireAirbnbAvailability\} from '\.\/airbnb-availability\.mjs'/);
  assert.match(source,/calendarChecks=await requireAirbnbAvailability\(\{db,table,units:result\.units/);
  assert.match(source,/const transact=\[\.\.\.calendarChecks,\{Put:/);
  assert.match(source,/PRODUCTION_AIRBNB_AVAILABILITY_UNVERIFIED/);
  assert.match(source,/currentRequestRules\(\)/);
});
