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
test('Easter, May half term and summer minimum stays follow proposed 3/5/7-night bands',()=>{
  assert.ok(evaluate({unit:'both',start:'2027-03-20',end:'2027-03-23',guests:10}).nights);
  assert.match(evaluate({unit:'geranium',start:'2027-03-26',end:'2027-03-30',guests:2}).error,/shorter/);
  assert.ok(evaluate({unit:'geranium',start:'2027-03-26',end:'2027-03-31',guests:2}).nights);
  assert.ok(evaluate({unit:'honeysuckle',start:'2027-05-10',end:'2027-05-13',guests:2}).nights);
  assert.match(evaluate({unit:'honeysuckle',start:'2027-05-22',end:'2027-05-26',guests:2}).error,/shorter/);
  assert.ok(evaluate({unit:'honeysuckle',start:'2027-05-22',end:'2027-05-27',guests:2}).nights);
  assert.match(evaluate({unit:'both',start:'2027-07-10',end:'2027-07-16',guests:10}).error,/shorter/);
  assert.ok(evaluate({unit:'both',start:'2027-07-10',end:'2027-07-17',guests:10}).nights);
  assert.ok(evaluate({unit:'geranium',start:'2027-09-04',end:'2027-09-09',guests:2}).nights);
  assert.ok(evaluate({unit:'geranium',start:'2027-09-20',end:'2027-09-23',guests:2}).nights);
  assert.match(evaluate({unit:'honeysuckle',start:'2027-09-30',end:'2027-10-03',guests:2}).error,/outside/);
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
