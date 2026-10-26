// Pure server-side quotation over separately verified staging availability and published prices.
// This endpoint NEVER holds dates or writes to the booking master.
const DAY=86400000;
function dateMillis(s){
 if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s))return NaN;
 const t=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?t:NaN;
}
export function quoteFromSnapshots({availability,pricing,unit,start,end,adults,children}){
 if(availability?.mode!=='LIVE_STAGING_MASTER_READ_ONLY'||pricing?.mode!=='STAGING_PUBLISHED_PRICING_READ_ONLY')throw Error('Master or published prices unavailable');
 const a=dateMillis(start),z=dateMillis(end),n=(z-a)/DAY;
 if(!Number.isInteger(n)||n<1||n>27||start<'2027-03-20'||end>'2027-10-02')throw Error('Invalid dates');
 // Site currently enforces Saturday-to-Saturday stays.
 if(new Date(a).getUTCDay()!==6||new Date(z).getUTCDay()!==6||n%7!==0)throw Error('Invalid changeover days');
 if(!Number.isInteger(adults)||!Number.isInteger(children)||adults<1||children<0)throw Error('Invalid guest numbers');
 const count=adults+children;
 const capacities={geranium:4,honeysuckle:6,both:10};
 if(!Object.hasOwn(capacities,unit)||count>capacities[unit])throw Error('Capacity exceeded');
 const units=unit==='both'?['geranium','honeysuckle']:[unit];
 const dates=Array.from({length:n},(_,i)=>new Date(a+i*DAY).toISOString().slice(0,10));
 const breakdown=[];
 let minimum=0;
 for(const u of units){
  const c=pricing.cottages?.[u];
  if(!c||!Number.isInteger(c.version)||c.version<1||!Array.isArray(c.value?.bands))throw Error('Published pricing unavailable');
  const blocks=availability.blocked?.[u];
  if(!Array.isArray(blocks))throw Error('Availability unavailable');
  if(dates.some(date=>blocks.some(x=>date>=x.from&&date<x.to)))throw Error('Dates occupied');
  let pennies=0;
  for(const date of dates){
   const bands=c.value.bands.filter(x=>date>=x.start&&date<x.end);
   if(bands.length!==1)throw Error('Published pricing unavailable');
   const band=bands[0];
   const rate=Number(band.nightlyGBP);
   if(!Number.isFinite(rate)||rate<=0||Math.round(rate*100)/100!==rate)throw Error('Invalid published rate');
   pennies+=Math.round(rate*100);
   minimum=Math.max(minimum,band.minNights);
  }
  breakdown.push({unit:u,version:c.version,priceGBP:pennies/100});
 }
 if(n<minimum)throw Error('Minimum stay not met');
 return {status:'STAGING_VERIFIED_READ_ONLY',start,end,nights:n,adults,children,units:breakdown,totalGBP:breakdown.reduce((v,x)=>v+x.priceGBP,0),minimumNights:minimum,verifiedAt:new Date().toISOString()};
}
