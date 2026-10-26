import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

const bundle=await build({
  entryPoints:['src/lib/booking-discovery.ts'],platform:'node',format:'esm',
  bundle:true,write:false,logLevel:'silent',absWorkingDir:process.cwd()
});
const src=Buffer.from(bundle.outputFiles[0].text).toString('base64');
const {matchingCottages,matchingOptions,referenceAllows,canPickCheckout,
  indicativeSelection,nightsInRange,minimumFor,daysForMonth,possibleNight,setMasterAvailability,clearMasterAvailability,masterConnected,setPublishedPricing,clearPublishedPricing,publishedQuote}=await import('data:text/javascript;base64,'+src);

const filter=(adults=2,children=0,bedrooms=0,choice='any')=>({adults,children,bedrooms,choice});
const fixture=JSON.parse(readFileSync(new URL('../data/booking-occupancy-snapshot-2027.json',import.meta.url),'utf8'));
function injectMaster(){
  setMasterAvailability({
    mode:'LIVE_STAGING_MASTER_READ_ONLY',
    capturedAt:new Date().toISOString(),
    firstNight:fixture.firstNight,lastNight:fixture.lastNight,lastCheckout:'2027-10-02',
    blocked:fixture.blocked
  });
}
injectMaster();
test('unavailable, stale, or malformed master is fail-closed; no 2026 fallback',()=>{
  clearMasterAvailability();
  assert.equal(masterConnected(),false);
  assert.equal(possibleNight('geranium','2027-07-10'),false);
  assert.equal(daysForMonth('honeysuckle','2027-07')[9].status,'unknown');
  assert.throws(()=>setMasterAvailability({...fixture,mode:'LIVE_STAGING_MASTER_READ_ONLY',capturedAt:'2026-10-24T12:00:00.000Z',lastCheckout:'2027-10-02'}),/masterUnavailable/);
  injectMaster();
  assert.equal(masterConnected(),true);
});


test('groups and bedroom requirements return suitable cottages or both only',()=>{
  assert.deepEqual(matchingCottages(filter()),['geranium','honeysuckle']);
  assert.deepEqual(matchingCottages(filter(4,0,2)),['geranium','honeysuckle']);
  assert.deepEqual(matchingCottages(filter(2,3,0)),['honeysuckle']);
  assert.deepEqual(matchingCottages(filter(5,2,0)),['both']);
  assert.deepEqual(matchingCottages(filter(2,0,4)),['both']);
  assert.deepEqual(matchingCottages(filter(1,0,1,'both')),['both']);
  assert.deepEqual(matchingCottages(filter(6,4,5)),['both']);
  assert.deepEqual(matchingCottages(filter(6,5,0)),[]);
  assert.deepEqual(matchingCottages(filter(0,2,0)),[]);
  assert.deepEqual(matchingCottages(filter(2,-1,0)),[]);
});

test('dated snapshot marks existing Airbnb and direct reservations, including BOTH-cottage held week',()=>{
  assert.equal(possibleNight('geranium','2027-05-22'),false);
  assert.equal(possibleNight('geranium','2027-05-29'),true);
  assert.equal(possibleNight('honeysuckle','2027-06-12'),false);
  assert.equal(possibleNight('honeysuckle','2027-06-19'),true);
  assert.equal(possibleNight('honeysuckle','2027-07-31'),false);
  assert.equal(possibleNight('honeysuckle','2027-08-14'),false);
  assert.equal(possibleNight('both','2027-08-28'),false);
  assert.equal(possibleNight('both','2027-09-03'),false);
  assert.equal(possibleNight('both','2027-09-04'),true);
  assert.equal(referenceAllows('both','2027-08-28','2027-09-04'),false);
  assert.equal(referenceAllows('both','2027-07-10','2027-07-17'),true);
  assert.equal(referenceAllows('honeysuckle','2027-08-07','2027-08-14'),true);
});

test('checkout may coincide with someone else arriving; arrival on a blocked day is refused',()=>{
  assert.equal(canPickCheckout('both','2027-08-25','2027-08-28'),true);
  assert.equal(canPickCheckout('both','2027-08-27','2027-08-29'),false);
  assert.equal(canPickCheckout('both','2027-09-04','2027-09-11'),true);
  assert.equal(canPickCheckout('both','2027-09-29','2027-10-02'),true);
  assert.throws(()=>nightsInRange('2027-08-10','2027-09-07'),/invalidDates/);
  assert.throws(()=>nightsInRange('2027-03-19','2027-03-22'),/outsideSeason/);
});

test('selecting a valid two-cottage range generates a provisional total and draft minimum',()=>{
  const f=filter(6,1,4);
  assert.deepEqual(matchingOptions(f,'2027-07-10','2027-07-17').map(x=>x.listedAs),['possible']);
  const q=indicativeSelection('both','2027-07-10','2027-07-17',f);
  assert.equal(q.nights,7);
  assert.equal(q.airbnbTotalGBP,3500);
  assert.equal(q.indicativeDirectTotalGBP,3100);
  assert.equal(q.draftMinimumNights,7);
  assert.equal(q.meetsDraftMinimum,true);
  assert.equal(q.adults,6);
  assert.equal(q.children,1);
  assert.throws(()=>indicativeSelection('both','2027-08-28','2027-09-04',f),/occupied/);
  assert.throws(()=>indicativeSelection('geranium','2027-07-10','2027-07-17',f),/capacity/);
});
test('two cottage calendar views require published prices and preserve independent known blocks',()=>{
  clearPublishedPricing();
  assert.equal(daysForMonth('honeysuckle','2027-08').find(d=>d.date==='2027-08-22').rateGBP,null);
  const periods=[
    ['low','2027-03-20','2027-04-24',3],
    ['shoulder','2027-04-24','2027-06-26',5],
    ['peak','2027-06-26','2027-08-28',7],
    ['shoulder','2027-08-28','2027-09-25',5],
    ['low','2027-09-25','2027-10-02',3]
  ];
  const cottage=(unit,version,peak)=>({unit,version,value:{unit,seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,bands:periods.map(([season,start,end,minNights])=>({
    season,start,end,minNights,nightlyGBP:(season==='peak'?peak:110).toFixed(2)
  }))}});
  setPublishedPricing({mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',capturedAt:new Date().toISOString(),
    cottages:{geranium:cottage('geranium',3,155),honeysuckle:cottage('honeysuckle',1,140)}});

  const geranium=daysForMonth('geranium','2027-08');
  const honeysuckle=daysForMonth('honeysuckle','2027-08');
  assert.equal(geranium.length,31);
  assert.equal(honeysuckle.length,31);
  assert.equal(geranium.find(d=>d.date==='2027-08-14').status,'possible');
  assert.equal(honeysuckle.find(d=>d.date==='2027-08-14').status,'occupied');
  assert.equal(honeysuckle.find(d=>d.date==='2027-08-22').rateGBP,140);
  assert.equal(geranium.find(d=>d.date==='2027-08-22').rateGBP,155);
  const published=publishedQuote('both','2027-07-10','2027-07-17',filter(6,1,4));
  assert.equal(published.totalGBP,2065);
  assert.deepEqual(published.units.map(x=>x.version),[3,1]);
  assert.equal(published.minimumNights,7);
  assert.equal(minimumFor('2027-07-10','2027-07-17'),7);
  assert.equal(minimumFor('2027-09-20','2027-09-23'),3);
});
