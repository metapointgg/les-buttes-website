// Owner-facing scenario calculator only. NO AWS calls, booking writes, payment links,
// public quote approval or actual Airbnb calendar availability checks.
// The 2027 reference nightly rates are a dated snapshot of Airbnb host calendars.
import {readFileSync} from 'node:fs';
import {dates,parseDate,DAY} from './rules.mjs';

const units=['geranium','honeysuckle'];
const dir=new URL('./config/',import.meta.url);
const observed=Object.fromEntries(units.map(unit=>[unit,
  JSON.parse(readFileSync(new URL('observed-airbnb-'+unit+'-2027.json',dir),'utf8'))]));
const approach=JSON.parse(readFileSync(new URL('direct-pricing-approach-2027.json',dir),'utf8'));
const proposed=JSON.parse(readFileSync(new URL('proposed-2027-reviewed-option-b.json',dir),'utf8'));

function pence(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>999999||Math.abs(value*100-Math.round(value*100))>1e-7)
    throw Error('Offer must be a positive GBP amount with no more than 2 decimal places');
  return Math.round(value*100);
}
function money(value){return (value/100).toFixed(2);}
function rateFor(unit,date){
  const rows=observed[unit].displayedNightlyRatesGBP.filter(p=>date>=p.start&&date<=p.end);
  if(rows.length!==1)throw Error('Airbnb screenshot rates are missing or ambiguous for '+unit+' on '+date);
  return pence(rows[0].amount);
}
function roundedGuide(baselinePence,nights){
  // A suggested starting point, NOT a fixed entitlement or auto-applied discount.
  // A weekly quote is usually a clean £50 per cottage, like the agreed example.
  const increment=nights>=7?5000:2500;
  const pct=approach.ownerQuotingPolicy.indicativeDiscountPercent;
  const amount=Math.round((baselinePence*(1-pct/100))/increment)*increment;
  return Math.max(increment,amount);
}
function netAfterFee(grossPence,percent){
  // Fee is rounded to the nearest penny, then deducted from the guest total.
  return grossPence-Math.round(grossPence*percent/100);
}
export function previewOwnerQuote({unit,start,end,offers={}}){
  if(!['geranium','honeysuckle','both'].includes(unit))throw Error('Cottage must be geranium, honeysuckle or both');
  const nights=dates(start,end);
  if(!nights)throw Error('Invalid stay: checkout must be after arrival, maximum 27 nights');
  if(start<'2027-03-20'||end>'2027-10-02')throw Error('Outside the proposed 2027 holiday season (20 March to 2 October checkout)');
  if(approach.status!=='HOST_CONFIRMED_PRICING_APPROACH_NOT_DEPLOYED')
    throw Error('Owner quoting policy is not ready for manual comparison');
  if(Object.keys(offers).some(name=>!units.includes(name)))throw Error('Unexpected cottage in offer overrides');
  const names=unit==='both'?units:[unit];
  if(Object.keys(offers).some(name=>!names.includes(name)))throw Error('Offer override provided for a cottage not selected');
  const items=names.map(name=>{
    if(observed[name].status!=='OBSERVED_AIRBNB_HOST_CALENDAR_NOT_APPROVED_FOR_DIRECT_BOOKINGS')
      throw Error('Only recorded Airbnb calendar reference prices may be used');
    const airbnbPence=nights.reduce((total,date)=>total+rateFor(name,date),0);
    const guide=roundedGuide(airbnbPence,nights.length);
    const offered=offers[name]===undefined?guide:pence(offers[name]);
    return {
      unit:name,airbnbComparableGBP:money(airbnbPence),
      indicativeRoundedOfferGBP:money(guide),selectedOfferGBP:money(offered),
      guestSavingsGBP:money(airbnbPence-offered),
      guestSavingPercent:Number(((airbnbPence-offered)/airbnbPence*100).toFixed(2)),
      selectedOfferIsManualOverride:offers[name]!==undefined
    };
  });
  const base=items.reduce((total,i)=>total+pence(Number(i.airbnbComparableGBP)),0);
  const offer=items.reduce((total,i)=>total+pence(Number(i.selectedOfferGBP)),0);
  const minimums=nights.map(day=>proposed.rules.minimumStays.filter(m=>day>=m.start&&day<=m.end));
  if(minimums.some(a=>a.length!==1))throw Error('Proposed minimum-stay bands do not cover this stay');
  const strictest=Math.max(...minimums.map(a=>a[0].nights));
  const abFee=approach.illustrativePlatformFees.airbnbHostFeePct;
  const paymentFee=approach.illustrativePlatformFees.sumupPaymentLinkFeePct;
  const airbnbNet=netAfterFee(base,abFee),directNet=netAfterFee(offer,paymentFee);
  return {
    status:'OWNER_REVIEW_ONLY_NOT_A_BOOKING_OR_PAYMENT_REQUEST',
    unit,start,end,nights:nights.length,
    items,
    total:{
      airbnbComparableGBP:money(base),
      indicativeSelectedDirectGBP:money(offer),
      guestSavingsGBP:money(base-offer),
      guestSavingPercent:Number(((base-offer)/base*100).toFixed(2)),
      assumedAirbnbHostNetGBP:money(airbnbNet),
      assumedDirectHostNetGBP:money(directNet),
      assumedHostNetDifferenceGBP:money(directNet-airbnbNet)
    },
    provisionalMinimumStayNights:strictest,
    provisionalMinimumStayMet:nights.length>=strictest,
    notes:[
      'Indicative direct price derived from a 24 October 2026 Airbnb screenshot snapshot, not live Airbnb prices or confirmed availability.',
      'Around 11% discount rounded per cottage is only a starting point: the owner manually approves/overrides each final offer.',
      'Approximate host net values use 15.5% Airbnb and 2.5% SumUp fees as unverified assumptions; neither is guaranteed.',
      'Minimum-stay periods are NOT FINAL; no season/rate/discount values have been approved or deployed.',
      'Do not reprice any earlier agreed or confirmed guest reservation; honour the existing Aug 28–Sep 4 £1450/£1650 direct agreement.',
      'Never collect payment without reviewed and agreed cancellation terms and independent availability checks.'
    ]
  };
}
