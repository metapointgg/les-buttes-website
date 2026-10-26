import assert from 'node:assert/strict';
import {findBookingOptions} from '../src/lib/booking-search.mjs';
const bands=[
 {season:'low',start:'2027-03-20',end:'2027-04-24',nightlyGBP:'105.00',minNights:3},
 {season:'shoulder',start:'2027-04-24',end:'2027-06-26',nightlyGBP:'115.00',minNights:5},
 {season:'peak',start:'2027-06-26',end:'2027-08-28',nightlyGBP:'155.00',minNights:7},
 {season:'shoulder',start:'2027-08-28',end:'2027-09-25',nightlyGBP:'115.00',minNights:5},
 {season:'low',start:'2027-09-25',end:'2027-10-02',nightlyGBP:'105.00',minNights:3}
];
const value={unit:'geranium',seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,bands};
const snapshot=unit=>({published:{unit,version:1,value:{...value,unit}},reservedNights:[]});
const params={checkIn:'2027-03-20',checkOut:'2027-03-23',adults:2,children:0,rooms:0};
assert.throws(()=>findBookingOptions({...params}),/not been loaded/);
const snapshots={geranium:snapshot('geranium'),honeysuckle:snapshot('honeysuckle')};
assert.equal(findBookingOptions({...params,snapshots}).length,3);
assert.deepEqual(findBookingOptions({...params,adults:7,snapshots}).map(o=>o.units),[['geranium','honeysuckle']]);
assert.deepEqual(findBookingOptions({...params,rooms:3,snapshots}).map(o=>o.units),[['honeysuckle'],['geranium','honeysuckle']]);
const unavailable={...snapshots,geranium:{...snapshots.geranium,reservedNights:['2027-03-21']}};
assert.deepEqual(findBookingOptions({...params,snapshots:unavailable}).map(o=>o.units),[['honeysuckle']]);
assert.deepEqual(findBookingOptions({...params,snapshots:{honeysuckle:snapshots.honeysuckle}}).map(o=>o.units),[['honeysuckle']]);
assert.equal(findBookingOptions({...params,snapshots})[2].totalGBP,'630.00');
console.log('Cottage combination and availability guards passed');
