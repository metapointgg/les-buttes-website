import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOwnerQuote} from '../owner-quote.mjs';

test('known Aug 28–Sep 4 precedent suggests exactly £1450 Geranium / £1650 Honeysuckle',()=>{
  const r=previewOwnerQuote({unit:'both',start:'2027-08-28',end:'2027-09-04'});
  assert.equal(r.status,'OWNER_REVIEW_ONLY_NOT_A_BOOKING_OR_PAYMENT_REQUEST');
  assert.deepEqual(r.items.map(x=>[x.unit,x.airbnbComparableGBP,x.indicativeRoundedOfferGBP]),[
    ['geranium','1630.00','1450.00'],
    ['honeysuckle','1845.00','1650.00']
  ]);
  assert.equal(r.total.airbnbComparableGBP,'3475.00');
  assert.equal(r.total.indicativeSelectedDirectGBP,'3100.00');
  assert.equal(r.total.guestSavingsGBP,'375.00');
  assert.equal(r.total.guestSavingPercent,10.79);
  assert.equal(r.total.assumedDirectHostNetGBP,'3022.50');
  assert.equal(r.total.assumedHostNetDifferenceGBP,'86.13');
  assert.equal(r.provisionalMinimumStayNights,7);
  assert.equal(r.provisionalMinimumStayMet,true);
  assert.ok(r.notes.some(s=>s.includes('not live Airbnb prices')));
});
test('future five-night quote spans month boundaries and preserves each cottage offer independently',()=>{
  const q=previewOwnerQuote({unit:'both',start:'2027-05-29',end:'2027-06-03'});
  assert.equal(q.nights,5);
  assert.deepEqual(q.items.map(i=>i.airbnbComparableGBP),['1055.00','1180.00']);
  assert.deepEqual(q.items.map(i=>i.indicativeRoundedOfferGBP),['950.00','1050.00']);
  assert.equal(q.total.airbnbComparableGBP,'2235.00');
  assert.equal(q.total.indicativeSelectedDirectGBP,'2000.00');
  assert.equal(q.provisionalMinimumStayNights,5);
});
test('explicit owner overrides can differ from guide but are not auto-approved or written',()=>{
  const q=previewOwnerQuote({unit:'both',start:'2027-08-28',end:'2027-09-04',offers:{geranium:1425,honeysuckle:1675}});
  assert.equal(q.total.indicativeSelectedDirectGBP,'3100.00');
  assert.equal(q.items[0].selectedOfferIsManualOverride,true);
  assert.equal(q.items[1].selectedOfferIsManualOverride,true);
  assert.deepEqual(q.items.map(i=>i.indicativeRoundedOfferGBP),['1450.00','1650.00']);
});
test('quotes strictly reject invalid properties, out-of-season dates, over-27-night stays and bad overrides',()=>{
  const basic={unit:'geranium',start:'2027-04-10',end:'2027-04-13'};
  assert.throws(()=>previewOwnerQuote({...basic,unit:'none'}),/Cottage/);
  assert.throws(()=>previewOwnerQuote({...basic,start:'2027-03-19'}),/season/);
  assert.throws(()=>previewOwnerQuote({...basic,end:'2027-10-03'}),/27 nights/);
  assert.throws(()=>previewOwnerQuote({...basic,start:'2027-09-30',end:'2027-10-03'}),/season/);
  assert.throws(()=>previewOwnerQuote({...basic,end:'2027-04-10'}),/Invalid stay/);
  assert.throws(()=>previewOwnerQuote({...basic,offers:{honeysuckle:150}}),/not selected/);
  assert.throws(()=>previewOwnerQuote({...basic,offers:{geranium:0}}),/positive GBP/);
  assert.throws(()=>previewOwnerQuote({...basic,offers:{geranium:130.555}}),/decimal places/);
  assert.throws(()=>previewOwnerQuote({...basic,offers:{other:130}}),/Unexpected cottage/);
});
test('short stay proposal is flagged separately, without falsely describing confirmed bookability',()=>{
  const q=previewOwnerQuote({unit:'honeysuckle',start:'2027-08-08',end:'2027-08-11'});
  assert.equal(q.provisionalMinimumStayNights,7);
  assert.equal(q.provisionalMinimumStayMet,false);
  assert.equal(q.status,'OWNER_REVIEW_ONLY_NOT_A_BOOKING_OR_PAYMENT_REQUEST');
});
