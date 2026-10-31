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
test('confirmed 20 March 2027 reopening applies to both cottages',()=>{
  for(const unit of ['geranium','honeysuckle','both']){
    const guests=unit==='both'?10:unit==='geranium'?4:6;
    const arrivingOnOpening=check({unit,start:'2027-03-20',end:'2027-03-27',guests});
    assert.ok(Array.isArray(arrivingOnOpening.nights),unit+' accepts March 20 arrival with a compliant 7-night stay');
    const arrivingBeforeOpening=check({unit,start:'2027-03-13',end:'2027-03-20',guests});
    assert.match(arrivingBeforeOpening.error,/outside the bookable season/,unit+' excludes pre-opening nights');
  }
});
test('Saturday-to-Saturday weekly stays are enforced across seasons',()=>{
  assert.equal(check({unit:'geranium',start:'2027-04-03',end:'2027-04-10',guests:4}).nights.length,7);
  assert.equal(check({unit:'honeysuckle',start:'2027-07-03',end:'2027-07-17',guests:6}).nights.length,14);
  assert.ok(check({unit:'geranium',start:'2027-04-04',end:'2027-04-11',guests:2}).error);
  assert.ok(check({unit:'geranium',start:'2027-04-03',end:'2027-04-06',guests:2}).error);
  assert.ok(check({unit:'geranium',start:'2027-04-03',end:'2027-05-01',guests:2}).error);
});
test('both cottages are only offered for parties exceeding six',()=>{
  assert.deepEqual(check({unit:'both',start:'2027-09-04',end:'2027-09-11',guests:10}).units,['geranium','honeysuckle']);
  assert.ok(check({unit:'both',start:'2027-09-04',end:'2027-09-11',guests:6}).error);
  assert.ok(check({unit:'both',start:'2027-09-04',end:'2027-09-11',guests:11}).error);
  assert.ok(check({unit:'geranium',start:'2027-09-04',end:'2027-09-11',guests:5}).error);
  assert.ok(check({unit:'geranium',start:'2027-10-02',end:'2027-10-09',guests:2}).error);
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
