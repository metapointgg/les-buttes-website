import preview from '../data/booking-preview-2027.json';

type Cottage = 'geranium'|'honeysuckle'|'both';
type Breakdown = {unit:'geranium'|'honeysuckle';airbnbGBP:number;indicativeDirectGBP:number;guestSavingGBP:number};
type Quote = {status:'INDICATIVE_ONLY';start:string;end:string;nights:number;guests:number;units:Breakdown[];airbnbTotalGBP:number;indicativeDirectTotalGBP:number;guestSavingGBP:number;guestSavingPercent:number;draftMinimumNights:number;meetsDraftMinimum:boolean};

const day=86400000;
function dateToNumber(value:string):number{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
  const number=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(number)&&new Date(number).toISOString().slice(0,10)===value?number:NaN;
}
function nightDates(start:string,end:string):string[]{
  const from=dateToNumber(start),to=dateToNumber(end);
  if(!Number.isFinite(from)||!Number.isFinite(to))throw Error('invalidDates');
  const count=(to-from)/day;
  if(!Number.isInteger(count)||count<1||count>27)throw Error('invalidDates');
  if(start<preview.firstNight||end>preview.lastCheckout)throw Error('outsideSeason');
  return Array.from({length:count},(_,i)=>new Date(from+i*day).toISOString().slice(0,10));
}
function priceOf(unit:'geranium'|'honeysuckle',date:string):number{
  const periods=preview.nights[unit].filter(period=>date>=period.from&&date<=period.to);
  if(periods.length!==1)throw Error('unavailableQuote');
  return periods[0].gbp;
}
export function previewBookingQuote(unit:Cottage,start:string,end:string,guests:number):Quote{
  if(!Object.hasOwn(preview.guestLimits,unit)||!Number.isInteger(guests)||guests<1||guests>preview.guestLimits[unit])throw Error('capacity');
  const nights=nightDates(start,end);
  const selected=unit==='both'?(['geranium','honeysuckle'] as const):([unit] as const);
  const units:Breakdown[]=selected.map(cottage=>{
    const airbnbGBP=nights.reduce((sum,date)=>sum+priceOf(cottage,date),0);
    const rounding=nights.length>=7?preview.pricing.roundWeeklyGBP:preview.pricing.roundShortGBP;
    const indicativeDirectGBP=Math.round((airbnbGBP*(1-preview.pricing.indicativeSavingPercent/100))/rounding)*rounding;
    if(indicativeDirectGBP<=0)throw Error('unavailableQuote');
    return {unit:cottage,airbnbGBP,indicativeDirectGBP,guestSavingGBP:airbnbGBP-indicativeDirectGBP};
  });
  const airbnbTotalGBP=units.reduce((sum,quote)=>sum+quote.airbnbGBP,0);
  const indicativeDirectTotalGBP=units.reduce((sum,quote)=>sum+quote.indicativeDirectGBP,0);
  const draftMinimumNights=Math.max(...nights.map(date=>{
    const rules=preview.proposedMinimumStays.filter(period=>date>=period.from&&date<=period.to);
    if(rules.length!==1)throw Error('unavailableQuote');
    return rules[0].nights;
  }));
  return {
    status:'INDICATIVE_ONLY',start,end,guests,nights:nights.length,units,
    airbnbTotalGBP,indicativeDirectTotalGBP,
    guestSavingGBP:airbnbTotalGBP-indicativeDirectTotalGBP,
    guestSavingPercent:Number(((airbnbTotalGBP-indicativeDirectTotalGBP)/airbnbTotalGBP*100).toFixed(2)),
    draftMinimumNights,meetsDraftMinimum:nights.length>=draftMinimumNights
  };
}
