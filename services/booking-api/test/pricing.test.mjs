import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFor,configuredQuote} from '../pricing.mjs';
const nights=['2027-06-30','2027-07-01','2027-07-02'];
const rates={
  periods:[
    {start:'2027-06-01',end:'2027-06-30',geranium:125,honeysuckle:150},
    {start:'2027-07-01',end:'2027-08-31',geranium:175,honeysuckle:210}
  ]
};
test('compute exact GBP total and distinct cottage breakdown across seasons',()=>{
  const quote=quoteFor(['geranium'],nights,rates);
  assert.equal(quote.totalGBP,'475.00');
  assert.deepEqual(quote.breakdown,[{unit:'geranium',amountGBP:'475.00'}]);
  assert.equal(quote.nights,3);
  const combined=quoteFor(['geranium','honeysuckle'],nights,rates);
  assert.equal(combined.totalGBP,'1045.00');
  assert.equal(combined.currency,'GBP');
});
test('reject missing, ambiguous, zero and invalid rates without fallback',()=>{
  assert.equal(quoteFor(['geranium'],['2027-09-02'],rates).serverError,true);
  assert.equal(quoteFor(['geranium'],nights,{periods:[...rates.periods,rates.periods[0]]}).serverError,true);
  assert.equal(quoteFor(['geranium'],nights,{periods:[{start:'2027-01-01',end:'2027-12-31',geranium:0}]}).serverError,true);
  assert.equal(quoteFor(['geranium'],nights,{periods:[{start:'2027-01-01',end:'2027-12-31',geranium:NaN}]}).serverError,true);
  assert.equal(quoteFor(['unrecognised'],nights,rates).serverError,true);
});
test('preserve penny-accurate totals',()=>{
  assert.equal(quoteFor(['geranium'],nights,{periods:[{start:'2027-01-01',end:'2027-12-31',geranium:161.05}]}).totalGBP,'483.15');
});
test('missing JSON configuration is not silently priced',()=>{
  const old=process.env.BOOKING_RATES_JSON;
  delete process.env.BOOKING_RATES_JSON;
  try{assert.equal(configuredQuote(['geranium'],nights).serverError,true);}
  finally{if(old===undefined)delete process.env.BOOKING_RATES_JSON;else process.env.BOOKING_RATES_JSON=old;}
});
