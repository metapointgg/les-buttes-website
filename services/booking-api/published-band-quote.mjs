// Authoritative arithmetic for the staging master's published 2027 pricing bands.
// Dates are UTC calendar dates; band end and checkout are exclusive.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export function quotePublishedBands(unit,start,end,pricing){
 const realDate=d=>ISO.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!['geranium','honeysuckle'].includes(unit)||!realDate(start)||!realDate(end)||start>=end)
  throw Error('Invalid quote selection');
 if(!pricing||pricing.unit!==unit||!Array.isArray(pricing.bands)||!pricing.bands.length||
    !ISO.test(pricing.seasonStart)||!ISO.test(pricing.seasonEnd)||
    start<pricing.seasonStart||end>pricing.seasonEnd)
  throw Error('Quote outside published season');
 const nights=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000);
 if(!Number.isInteger(nights)||nights<1||nights>27)throw Error('Invalid stay length');
 if(new Date(start+'T00:00:00Z').getUTCDay()!==6||
    new Date(end+'T00:00:00Z').getUTCDay()!==6)
  throw Error('Saturday arrival and departure required');
 if(!Number.isInteger(pricing.maxNights)||nights>pricing.maxNights)
  throw Error('Stay exceeds published maximum');
 let totalPence=0;
 for(let t=Date.parse(start+'T00:00:00Z');t<Date.parse(end+'T00:00:00Z');t+=86400000){
  const date=new Date(t).toISOString().slice(0,10);
  const matching=pricing.bands.filter(b=>b.start<=date&&date<b.end);
  if(matching.length!==1)throw Error('Missing or ambiguous published nightly rate');
  const band=matching[0];
  if(!Number.isInteger(band.minNights)||nights<band.minNights)
   throw Error('Below published minimum stay');
  if(typeof band.nightlyGBP!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(band.nightlyGBP))
   throw Error('Invalid published nightly rate');
  const [pence,frac='']=band.nightlyGBP.split('.');
  const amount=Number(pence)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000)
   throw Error('Invalid published nightly rate');
  totalPence+=amount;
 }
 return {unit,currency:'GBP',nights,totalGBP:(totalPence/100).toFixed(2),
         priceSource:'published-staging-pricing',bookingConfirmed:false};
}
