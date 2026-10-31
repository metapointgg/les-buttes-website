import test from 'node:test';
import assert from 'node:assert/strict';
import {quotePublishedBands} from './published-band-quote.mjs';
const pricing={unit:'geranium',seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,
 bands:[{start:'2027-03-20',end:'2027-04-24',nightlyGBP:'105.00',minNights:3},
 {start:'2027-04-24',end:'2027-10-02',nightlyGBP:'115.00',minNights:5}]};
test('seven-night quote uses published GBP amounts, not indicative prices',()=>{
 assert.equal(quotePublishedBands('geranium','2027-04-03','2027-04-10',pricing).totalGBP,'735.00');
});
test('Saturday-to-Saturday quote sums rates across a band boundary',()=>{
 assert.equal(quotePublishedBands('geranium','2027-04-17','2027-05-01',pricing).totalGBP,'1540.00');
});
test('fails closed for gaps, invalid prices, out-of-season and non-Saturday stays',()=>{
 assert.throws(()=>quotePublishedBands('geranium','2027-04-03','2027-04-10',{...pricing,bands:[]}));
 assert.throws(()=>quotePublishedBands('geranium','2027-04-03','2027-04-10',{...pricing,bands:[{...pricing.bands[0],nightlyGBP:'abc'}]}));
 assert.throws(()=>quotePublishedBands('geranium','2027-04-04','2027-04-11',pricing),/Saturday/);
 assert.throws(()=>quotePublishedBands('geranium','2027-02-30','2027-03-06',pricing),/Invalid quote selection/);
 assert.throws(()=>quotePublishedBands('geranium','2027-03-13','2027-03-20',pricing),/season/);
 assert.throws(()=>quotePublishedBands('geranium','2027-04-03','2027-05-01',pricing),/length/);
});
