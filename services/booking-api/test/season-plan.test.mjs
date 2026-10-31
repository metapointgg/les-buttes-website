import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dates,DAY,parseDate,validBooking} from '../rules.mjs';
import {quoteFor,configuredQuote} from '../pricing.mjs';

const plan=JSON.parse(readFileSync(new URL('../config/proposed-2027-reviewed-option-b.json',import.meta.url),'utf8'));
const from=plan.season.firstArrival,to=plan.season.lastCheckout;
const allNights=Array.from({length:(parseDate(to)-parseDate(from))/DAY},
  (_,i)=>new Date(parseDate(from)+i*DAY).toISOString().slice(0,10));
function withEnvironment(key,value,run){
  const previous=process.env[key];
  process.env[key]=value;
  try{return run();}finally{
    if(previous===undefined)delete process.env[key];else process.env[key]=previous;
  }
}
function evaluate(input){
  return withEnvironment('BOOKING_RULES_JSON',JSON.stringify(plan.rules),()=>validBooking(input));
}
test('proposed Option B schedule covers every one of 196 2027 cottage nights without overlapping prices or minimum stays',()=>{
  assert.equal(plan.status,'PROPOSED_ONLY_NOT_APPROVED_OR_DEPLOYED');
  assert.equal(plan.rates.status,'PROPOSED_ONLY_NOT_APPROVED');
  assert.deepEqual(plan.rules.openSeasons,[{start:'2027-03-20',end:'2027-10-01'}]);
  assert.equal(allNights.length,196);
  for(const night of allNights){
    const rates=plan.rates.periods.filter(p=>night>=p.start&&night<=p.end);
    const minimums=plan.rules.minimumStays.filter(p=>night>=p.start&&night<=p.end);
    assert.equal(rates.length,1,'exactly one nightly rate on '+night);
    assert.equal(minimums.length,1,'exactly one minimum stay on '+night);
    assert.ok([3,5,7].includes(minimums[0].nights));
    assert.ok(rates[0].geranium>0&&rates[0].honeysuckle>0);
    assert.ok(quoteFor(['geranium','honeysuckle'],[night],plan.rates).totalGBP);
  }
  const outOfSeason=plan.rates.periods.filter(p=>p.start<from||p.end>=to);
  assert.deepEqual(outOfSeason,[]);
});
test('weekly Saturday stays apply consistently through the proposed seasonal bands',()=>{
  for(const start of ['2027-03-20','2027-05-22','2027-07-10','2027-09-04']){
    const end=new Date(parseDate(start)+7*DAY).toISOString().slice(0,10);
    assert.equal(evaluate({unit:'both',start,end,guests:10}).nights.length,7);
  }
  assert.match(evaluate({unit:'geranium',start:'2027-03-20',end:'2027-03-23',guests:2}).error,/Saturday/);
  assert.match(evaluate({unit:'honeysuckle',start:'2027-05-22',end:'2027-05-27',guests:2}).error,/Saturday/);
  assert.match(evaluate({unit:'both',start:'2027-07-10',end:'2027-07-16',guests:10}).error,/Saturday/);
  assert.match(evaluate({unit:'honeysuckle',start:'2027-09-25',end:'2027-10-02',guests:2}).error,/outside/);
});
test('nightly totals cross month and overlay boundaries without incorrectly repricing the direct reservation',()=>{
  const week=dates('2027-08-28','2027-09-04');
  const q=quoteFor(['geranium','honeysuckle'],week,plan.rates);
  assert.equal(q.nights,7);
  assert.deepEqual(q.breakdown,[
    {unit:'geranium',amountGBP:'1745.00'},
    {unit:'honeysuckle',amountGBP:'1975.00'}
  ]);
  assert.equal(q.totalGBP,'3720.00');
  assert.ok(plan.exceptions.some(text=>text.includes('28 August to 4 September 2027')));
});
test('unapproved proposed rates never enable public or staging API quotes',()=>{
  for(const environment of ['staging','production']){
    withEnvironment('BOOKING_ENVIRONMENT',environment,()=>{
      withEnvironment('BOOKING_RATES_JSON',JSON.stringify(plan.rates),()=>{
        assert.equal(configuredQuote(['geranium'],['2027-08-29']).serverError,true);
      });
    });
  }
});

test('both Airbnb screenshot baselines cover all 196 occupied nights and match the returning guest quotes',()=>{
  const geranium=JSON.parse(readFileSync(new URL('../config/observed-airbnb-geranium-2027.json',import.meta.url),'utf8'));
  const honeysuckle=JSON.parse(readFileSync(new URL('../config/observed-airbnb-honeysuckle-2027.json',import.meta.url),'utf8'));
  assert.equal(geranium.status,'OBSERVED_AIRBNB_HOST_CALENDAR_NOT_APPROVED_FOR_DIRECT_BOOKINGS');
  assert.equal(honeysuckle.status,'OBSERVED_AIRBNB_HOST_CALENDAR_NOT_APPROVED_FOR_DIRECT_BOOKINGS');
  const monthly = {geranium,honeysuckle};
  let totals={geranium:0,honeysuckle:0};
  for(const day of allNights){
    for(const [unit,calendar] of Object.entries(monthly)){
      const matches=calendar.displayedNightlyRatesGBP.filter(row=>day>=row.start&&day<=row.end);
      assert.equal(matches.length,1,unit+' Airbnb pricing is missing or duplicated on '+day);
      assert.ok(Number.isFinite(matches[0].amount)&&matches[0].amount>0);
      totals[unit]+=matches[0].amount;
    }
  }
  assert.deepEqual(totals,{geranium:42120,honeysuckle:47695});
  const heldWeek=dates('2027-08-28','2027-09-04');
  for(const [unit,expected] of [['geranium',1630],['honeysuckle',1845]]){
    const observed=monthly[unit];
    const rates=observed.displayedNightlyRatesGBP.map(p=>({
      start:p.start,end:p.end,[unit]:p.amount
    }));
    const quote=quoteFor([unit],heldWeek,{periods:rates});
    assert.equal(Number(quote.totalGBP),expected);
    assert.equal(Number(quote.totalGBP),observed.verifiedHeldDirectWeek.earlierAirbnbQuoteGBP);
  }
  assert.equal(totals.geranium+totals.honeysuckle,89815);
});
