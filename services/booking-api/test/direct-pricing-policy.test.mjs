import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dates} from '../rules.mjs';
import {quoteFor,configuredQuote} from '../pricing.mjs';

const dir=new URL('../config/',import.meta.url);
const policy=JSON.parse(readFileSync(new URL('direct-pricing-approach-2027.json',dir),'utf8'));
const calendars={
  geranium:JSON.parse(readFileSync(new URL('observed-airbnb-geranium-2027.json',dir),'utf8')),
  honeysuckle:JSON.parse(readFileSync(new URL('observed-airbnb-honeysuckle-2027.json',dir),'utf8'))
};
test('actual £1450/£1650 host-agreed direct quote shares fee savings and preserves Airbnb comparable amounts',()=>{
  const booking=policy.actualDirectBookingPrecedent;
  assert.equal(policy.status,'HOST_CONFIRMED_PRICING_APPROACH_NOT_DEPLOYED');
  assert.equal(booking.reservationStatus,'RESERVED_PENDING_FINAL_CONFIRMATION');
  const nights=dates(booking.start,booking.checkout);
  assert.equal(nights.length,7);
  let airbnbTotal=0,directTotal=0;
  for(const unit of ['geranium','honeysuckle']){
    const periods=calendars[unit].displayedNightlyRatesGBP.map(x=>({
      start:x.start,end:x.end,[unit]:x.amount
    }));
    const shown=Number(quoteFor([unit],nights,{periods}).totalGBP);
    assert.equal(shown,booking.units[unit].airbnbComparableGBP);
    assert.ok(booking.units[unit].agreedDirectGBP<shown);
    airbnbTotal+=shown;
    directTotal+=booking.units[unit].agreedDirectGBP;
    // Illustrative 11%-below-Airbnb weekly guide, rounded to clean £50 per cottage.
    assert.equal(Math.round(shown*0.89/50)*50,booking.units[unit].agreedDirectGBP);
  }
  assert.equal(airbnbTotal,3475);
  assert.equal(directTotal,3100);
  assert.equal(airbnbTotal-directTotal,375);
  assert.ok(Math.abs((1-directTotal/airbnbTotal)*100-10.79)<0.01);
  const estimatedAirbnbNet=airbnbTotal*(1-.155);
  const estimatedDirectNet=directTotal*(1-.025);
  assert.ok(Math.abs((estimatedDirectNet-estimatedAirbnbNet)-86.125)<0.001);
});
test('confirmed split-savings approach is NOT a deployed rate or automatically applied discount',()=>{
  assert.equal(policy.ownerQuotingPolicy.hostApprovalRequired,true);
  assert.equal(policy.ownerQuotingPolicy.doNotAutoRepriceExistingReservations,true);
  assert.equal(policy.deployment.approvedNightlyRates,false);
  assert.equal(policy.deployment.enabledInStaging,false);
  assert.equal(policy.deployment.enabledInProduction,false);
  const oldEnvironment=process.env.BOOKING_ENVIRONMENT,oldRates=process.env.BOOKING_RATES_JSON;
  try{
    process.env.BOOKING_ENVIRONMENT='production';
    process.env.BOOKING_RATES_JSON=JSON.stringify(policy);
    assert.equal(configuredQuote(['geranium'],['2027-08-29']).serverError,true);
  }finally{
    if(oldEnvironment===undefined)delete process.env.BOOKING_ENVIRONMENT;
    else process.env.BOOKING_ENVIRONMENT=oldEnvironment;
    if(oldRates===undefined)delete process.env.BOOKING_RATES_JSON;
    else process.env.BOOKING_RATES_JSON=oldRates;
  }
});
