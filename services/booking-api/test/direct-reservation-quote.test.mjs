import test from 'node:test';
import assert from 'node:assert/strict';
import {agreedDirectQuote} from '../direct-reservation-quote.mjs';

const reserved={
  unit:'both',units:['geranium','honeysuckle'],
  status:'BLOCKED',source:'direct',reservationStatus:'RESERVED',
  start:'2027-08-28',end:'2027-09-04'
};

test('owner-agreed direct quote captures £1450 + £1650 without marking paid or confirmed',()=>{
  const quoted=agreedDirectQuote(reserved,['geranium=1450','honeysuckle=1650'],
    {capturedAt:'2026-10-24T15:00:00Z'});
  assert.deepEqual(quoted.perCottage,[
    {unit:'geranium',amountGBP:'1450.00'},
    {unit:'honeysuckle',amountGBP:'1650.00'}
  ]);
  assert.equal(quoted.totalGBP,'3100.00');
  assert.equal(quoted.paymentVerified,false);
  assert.equal(quoted.bookingConfirmed,false);
  assert.equal(quoted.priceSource,'Owner-negotiated direct guest offer');
  assert.equal(quoted.capturedAt,'2026-10-24T15:00:00Z');
});
test('agreed direct quote is permitted for one cottage only when reservation actually covers it',()=>{
  const single={...reserved,unit:'geranium',units:['geranium']};
  const price=agreedDirectQuote(single,['geranium=950.50']);
  assert.equal(price.totalGBP,'950.50');
  assert.throws(()=>agreedDirectQuote(single,['geranium=950','honeysuckle=100']),/one UNIT/);
});
test('blocks non-direct, paid, cancelled or source-unverified record classifications',()=>{
  for(const invalid of [
    {...reserved,status:'CANCELLED'},
    {...reserved,status:'CONFIRMED'},
    {...reserved,source:'airbnb'},
    {...reserved,source:'unclassified'},
    {...reserved,reservationStatus:'CONFIRMED'}
  ])assert.throws(()=>agreedDirectQuote(invalid,['geranium=1450','honeysuckle=1650']),/direct \/ RESERVED/);
});
test('rejects incomplete, zero, negative, duplicated and malformed cottage prices',()=>{
  for(const pairs of [
    ['geranium=1450'],
    ['geranium=1450','geranium=1650'],
    ['geranium=1450','honeysuckle=0'],
    ['geranium=1450','honeysuckle=-100'],
    ['geranium=1450.333','honeysuckle=1650'],
    ['honeysuckle=1650','both=1450'],
    ['geranium=1450','honeysuckle=1e3'],
    ['geranium=1450','honeysuckle=']
  ])assert.throws(()=>agreedDirectQuote(reserved,pairs));
  assert.throws(()=>agreedDirectQuote({...reserved,units:['geranium','geranium']},
    ['geranium=1450','honeysuckle=1650']),/metadata/);
});
