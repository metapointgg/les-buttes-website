import test from 'node:test';
import assert from 'node:assert/strict';
import {directCalendarPreview} from './direct-calendar-preview.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
test('export preview includes active direct nights, excludes Airbnb and cancelled/expired holds, leaks no guest data',async()=>{
 const rows=['direct','airbnb','cancelled','expired'].map((id,i)=>({PK:'UNIT#geranium',SK:'DATE#2027-04-'+(10+i),id,...(id==='expired'?{expiresAt:20}:{})}));
 const db={send:async c=>c.input.KeyConditionExpression?{Items:rows}:{Item:{source:c.input.Key.PK.endsWith('airbnb')?'airbnb':'direct',status:c.input.Key.PK.endsWith('cancelled')?'CANCELLED':'CONFIRMED',units:['geranium'],start:'2027-04-10',end:'2027-04-17',guestEmail:'private@example.invalid'}}};
 const result=await directCalendarPreview({db,table,unit:'geranium',now:100});
 assert.equal(result.mode,'READ_ONLY_ICAL_FEED');assert.equal(result.feedReady,true);
 assert.equal(result.externalSubscriptionActivated,false);assert.equal(result.reservedNights,1);
 assert.match(result.calendar,/DTSTART;VALUE=DATE:20270410\r\nDTEND;VALUE=DATE:20270411/);
 assert.match(result.calendar,/METHOD:PUBLISH/);assert.match(result.calendar,/X-PUBLISHED-TTL:PT15M/);
 assert.doesNotMatch(result.calendar,/private|airbnb|cancelled|expired/);
});

test('export coalesces adjacent direct nights without exposing booking identifiers',async()=>{
 const rows=['2027-04-10','2027-04-11','2027-04-13'].map((day,i)=>({PK:'UNIT#honeysuckle',SK:'DATE#'+day,id:'booking-'+i}));
 const db={send:async c=>c.input.KeyConditionExpression?{Items:rows}:{Item:{source:'direct',status:'CONFIRMED',units:['honeysuckle'],start:c.input.Key.PK.endsWith('0')?'2027-04-10':c.input.Key.PK.endsWith('1')?'2027-04-11':'2027-04-13',end:c.input.Key.PK.endsWith('0')?'2027-04-11':c.input.Key.PK.endsWith('1')?'2027-04-12':'2027-04-14'}}};
 const result=await directCalendarPreview({db,table,unit:'honeysuckle',now:100});
 assert.equal((result.calendar.match(/BEGIN:VEVENT/g)||[]).length,2);
 assert.match(result.calendar,/DTSTART;VALUE=DATE:20270410\r\nDTEND;VALUE=DATE:20270412/);
 assert.doesNotMatch(result.calendar,/booking-/);
});

test('production feed is not limited to the 2027 season',async()=>{
 const rows=[{PK:'UNIT#geranium',SK:'DATE#2028-04-01',id:'future'}];
 const db={send:async c=>c.input.KeyConditionExpression?{Items:rows}:{Item:{source:'direct',status:'CONFIRMED',
  units:['geranium'],start:'2028-04-01',end:'2028-04-02'}}};
 const result=await directCalendarPreview({db,table:'les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2',
  unit:'geranium',now:100});
 assert.match(result.calendar,/DTSTART;VALUE=DATE:20280401\r\nDTEND;VALUE=DATE:20280402/);
});
