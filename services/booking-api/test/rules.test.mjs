import test from 'node:test';
import assert from 'node:assert/strict';
import {dates,parseDate,validBooking,guernseyToday} from '../rules.mjs';

const exampleRules={
  openSeasons:[{start:'2027-03-20',end:'2027-10-01'}],
  minimumStays:[
    {start:'2027-03-20',end:'2027-05-31',nights:3},
    {start:'2027-06-01',end:'2027-06-30',nights:5},
    {start:'2027-07-01',end:'2027-08-31',nights:7},
    {start:'2027-09-01',end:'2027-10-01',nights:5}
  ]
};
function check(input){process.env.BOOKING_RULES_JSON=JSON.stringify(exampleRules);return validBooking(input);}
test('date parsing rejects invalid dates',()=>{
  assert.ok(Number.isNaN(parseDate('2027-02-29')));
  assert.ok(Number.isNaN(parseDate('27-07-01')));
  assert.ok(Number.isFinite(parseDate('2028-02-29')));
});
test('checkout date is exclusive; allow 27 nights but reject 28',()=>{
  assert.equal(dates('2027-07-01','2027-07-28').length,27);
  assert.equal(dates('2027-07-01','2027-07-29'),null);
  assert.equal(dates('2027-07-01','2027-07-01'),null);
  assert.equal(dates('2027-07-02','2027-07-01'),null);
});
test('short stays respect low/shoulder/peak minimum stays',()=>{
  assert.equal(check({unit:'geranium',start:'2027-04-04',end:'2027-04-07',guests:4}).nights.length,3);
  assert.ok(check({unit:'geranium',start:'2027-06-10',end:'2027-06-14',guests:2}).error);
  assert.equal(check({unit:'honeysuckle',start:'2027-07-01',end:'2027-07-08',guests:6}).nights.length,7);
  assert.ok(check({unit:'honeysuckle',start:'2027-07-01',end:'2027-07-07',guests:2}).error);
});
test('split minimum-stay periods use the strictest minimum over occupied nights',()=>{
  assert.ok(check({unit:'geranium',start:'2027-06-28',end:'2027-07-04',guests:2}).error);
  assert.equal(check({unit:'geranium',start:'2027-06-28',end:'2027-07-05',guests:2}).nights.length,7);
});
test('capacity and closed-season validation applies to both cottages atomically',()=>{
  assert.deepEqual(check({unit:'both',start:'2027-09-01',end:'2027-09-08',guests:10}).units,['geranium','honeysuckle']);
  assert.ok(check({unit:'both',start:'2027-09-01',end:'2027-09-08',guests:11}).error);
  assert.ok(check({unit:'geranium',start:'2027-09-01',end:'2027-09-08',guests:5}).error);
  assert.ok(check({unit:'geranium',start:'2027-10-01',end:'2027-10-05',guests:2}).error);
});
test('unconfigured booking rules fail closed',()=>{
  process.env.BOOKING_RULES_JSON='{}';
  assert.equal(validBooking({unit:'geranium',start:'2027-08-01',end:'2027-08-08',guests:2}).serverError,true);
});

test('Guernsey local date follows BST and GMT, not AWS UTC',()=>{
  assert.equal(guernseyToday(new Date('2026-10-24T23:30:00Z')),'2026-10-25');
  assert.equal(guernseyToday(new Date('2026-12-01T23:30:00Z')),'2026-12-01');
  assert.equal(guernseyToday(new Date('2027-03-29T23:30:00Z')),'2027-03-30');
});
