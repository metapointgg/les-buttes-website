import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAirbnbCalendar,consolidateBlockedNights} from '../preview-airbnb.mjs';
const lines=[
  'BEGIN:VCALENDAR','VERSION:2.0',
  'BEGIN:VEVENT','UID:booking-a','DTSTART;VALUE=DATE:20270828','DTEND;VALUE=DATE:20270904',
  'SUMMARY:Reserved guest name must not leak','END:VEVENT',
  'BEGIN:VEVENT','UID:booking-b','DTSTART;VALUE=DATE:20270903','DTEND;VALUE=DATE:20270906','END:VEVENT',
  'BEGIN:VEVENT','UID:cancelled','DTSTART;VALUE=DATE:20271001','DTEND;VALUE=DATE:20271005',
  'STATUS:CANCELLED','END:VEVENT','END:VCALENDAR'
];
const calendar=lines.join('\r\n')+'\r\n';
test('parse Airbnb all-day iCal and deduplicate overlapping blocks',()=>{
  const parsed=parseAirbnbCalendar(calendar);
  assert.equal(parsed.eventCount,3);
  assert.equal(parsed.blockedNights.length,9);
  assert.deepEqual(consolidateBlockedNights(parsed.blockedNights,{fromDate:'2027-08-01'}),[
    {start:'2027-08-28',end:'2027-09-06',nights:9}
  ]);
  assert.equal(JSON.stringify(parsed).includes('guest name'),false);
});
test('exclude past days and split blocks within DynamoDB transaction budget',()=>{
  const longDates=Array.from({length:105},(_,i)=>new Date(Date.UTC(2027,0,1+i)).toISOString().slice(0,10));
  const groups=consolidateBlockedNights(longDates,{fromDate:'2027-01-01',maxBlock:99});
  assert.deepEqual(groups.map(g=>g.nights),[99,6]);
  assert.equal(groups[0].end,groups[1].start);
  assert.equal(consolidateBlockedNights(longDates,{fromDate:'2027-04-16'}).length,0);
});
test('fail closed on unsupported date-time, malformed and recurrence formats',()=>{
  const timed=calendar.replace('20270828','20270828T160000Z');
  assert.throws(()=>parseAirbnbCalendar(timed),/all-day/);
  const recurrence=calendar.replace('END:VEVENT','RRULE:FREQ=WEEKLY\r\nEND:VEVENT');
  assert.throws(()=>parseAirbnbCalendar(recurrence),/Recurring/);
  assert.throws(()=>parseAirbnbCalendar('not a calendar'),/Not an iCalendar/);
  assert.throws(()=>parseAirbnbCalendar(calendar.replace('20270904','20270800')),/Invalid iCalendar/);
});
test('preserves RFC5545 folded date fields',()=>{
  const folded=calendar.replace('DTSTART;VALUE=DATE:20270828','DTSTART;VALUE=DATE:\r\n 20270828');
  assert.deepEqual(parseAirbnbCalendar(folded).blockedNights,parseAirbnbCalendar(calendar).blockedNights);
});
