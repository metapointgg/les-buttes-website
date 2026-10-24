import test from 'node:test';
import assert from 'node:assert/strict';
import {validClassification,normalizeExternalReference,classificationForRecord} from '../reservation-metadata.mjs';
import {compareAirbnbBlocks} from '../reconcile-logic.mjs';

test('source and reservation status stay separate from occupied-date status',()=>{
  assert.equal(validClassification('airbnb','CONFIRMED'),true);
  assert.equal(validClassification('airbnb','RESERVED'),false);
  assert.equal(validClassification('direct','RESERVED'),true);
  assert.equal(validClassification('direct','CONFIRMED'),true);
  assert.equal(validClassification('winter-let','CONFIRMED'),true);
  assert.equal(validClassification('maintenance','BLOCKED'),true);
  assert.equal(validClassification('direct','PAID'),false);
  assert.equal(validClassification('__proto__','CONFIRMED'),false);
  assert.deepEqual(classificationForRecord({status:'BLOCKED'}),{source:'unclassified',reservationStatus:'UNVERIFIED'});
  assert.throws(()=>classificationForRecord({status:'CANCELLED'}),/existing manual/);
  assert.equal(normalizeExternalReference('-'),undefined);
  assert.equal(normalizeExternalReference(' HMBK123 '),'HMBK123');
  assert.throws(()=>normalizeExternalReference('bad\nvalue'),/External reference/);
});
test('reconciliation distinguishes Airbnb nights, separate direct reservations and true discrepancies',()=>{
  const year='2027';
  const slot=(unit,day,id,extras={})=>({PK:'UNIT#'+unit,SK:'DATE#'+year+'-'+day,id,...extras});
  const rows=[
    slot('geranium','05-22','airbnb1'),
    slot('geranium','05-23','airbnb1'),
    slot('geranium','06-19','airbnb2'),
    slot('geranium','08-28','direct1'),
    slot('geranium','08-29','direct1'),
    slot('geranium','09-05','unknown1'),
    slot('geranium','09-06','expired',{expiresAt:1}),
  ];
  rows[6].id='expired';
  rows[6].expiresAt=1;
  const meta=new Map([
    ['airbnb1',{source:'airbnb',reservationStatus:'CONFIRMED'}],
    ['airbnb2',{source:'airbnb',reservationStatus:'CONFIRMED'}],
    ['direct1',{source:'direct',reservationStatus:'RESERVED'}]
  ]);
  const result=compareAirbnbBlocks([
    '2027-05-22','2027-05-23','2027-06-20','2027-08-28','2027-08-29','2027-09-06'
  ],rows,meta,{from:'2027-03-20',to:'2027-10-02',now:1000});
  assert.equal(result.feedNightCount,6);
  assert.equal(result.masterNightCount,6);
  assert.deepEqual(result.alignedAirbnb,[{start:'2027-05-22',end:'2027-05-24',nights:2}]);
  assert.deepEqual(result.missingFromAirbnb,[{start:'2027-06-19',end:'2027-06-20',nights:1}]);
  assert.deepEqual(result.missingInMaster,[{start:'2027-06-20',end:'2027-06-21',nights:1},{start:'2027-09-06',end:'2027-09-07',nights:1}]);
  assert.deepEqual(result.otherOnAirbnb,[{start:'2027-08-28',end:'2027-08-30',nights:2}]);
  assert.deepEqual(result.unclassified,[{start:'2027-09-05',end:'2027-09-06',nights:1}]);
  assert.deepEqual(result.otherOnlyMaster,[]);
});
test('reconciliation does not mutate booking metadata or allow missing date bounds',()=>{
  const m=new Map();
  assert.throws(()=>compareAirbnbBlocks([],[],m,{from:'2027-04-01'}),/comparison dates/);
  assert.throws(()=>compareAirbnbBlocks([],[],m,{from:'2027-04-02',to:'2027-04-01'}),/comparison dates/);
  assert.deepEqual(compareAirbnbBlocks([],[],m,{from:'2027-04-01',to:'2027-04-02'}).missingInMaster,[]);
  assert.equal(m.size,0);
});
