import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFromSnapshots} from '../public-quote.mjs';
const bands=[
 ['low','2027-03-20','2027-04-24',3],
 ['shoulder','2027-04-24','2027-06-26',5],
 ['peak','2027-06-26','2027-08-28',7],
 ['shoulder','2027-08-28','2027-09-25',5],
 ['low','2027-09-25','2027-10-02',3]
];
const cottage=(unit,version,peak)=>({version,value:{bands:bands.map(([season,start,end,minNights])=>({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}});
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[{from:'2027-08-28',to:'2027-09-04'}],honeysuckle:[]}};
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{geranium:cottage('geranium',3,155),honeysuckle:cottage('honeysuckle',1,140)}};
const args={availability,pricing,unit:'both',start:'2027-07-10',end:'2027-07-17',adults:6,children:1};
test('both cottages are server repriced against published versions without creating holds',()=>{
 const q=quoteFromSnapshots(args);
 assert.equal(q.totalGBP,2065);
 assert.deepEqual(q.units.map(x=>x.version),[3,1]);
 assert.equal(q.minimumNights,7);
 assert.equal(q.status,'STAGING_VERIFIED_READ_ONLY');
});
test('occupied dates, unsafe lengths and guest count reject',()=>{
 assert.throws(()=>quoteFromSnapshots({...args,start:'2027-08-28',end:'2027-09-04'}),/occupied/i);
 assert.throws(()=>quoteFromSnapshots({...args,end:'2027-08-07'}),/dates/i);
 assert.throws(()=>quoteFromSnapshots({...args,adults:11}),/capacity/i);
 assert.throws(()=>quoteFromSnapshots({...args,pricing:null}),/unavailable/i);
});
