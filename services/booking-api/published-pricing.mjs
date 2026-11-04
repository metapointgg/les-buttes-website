// The only authoritative source of direct booking prices is the published
// versioned configuration in the shared booking master, never Lambda env rates.
import {readSetting} from './booking-settings.mjs';

const COTTAGES=new Set(['geranium','honeysuckle']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const PRICE=/^(\d{1,5})(?:\.(\d{1,2}))?$/;
const unavailable=error=>({error,serverError:true});

function pennies(amount){
 const m=PRICE.exec(String(amount??''));
 if(!m)return null;
 const p=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
 return Number.isSafeInteger(p)&&p>0&&p<=1000000?p:null;
}

export async function quoteFromPublishedMaster({db,table,units,nights}={}){
 if(!db?.send||!table||!Array.isArray(units)||!units.length||
    new Set(units).size!==units.length||units.some(x=>!COTTAGES.has(x))||
    !Array.isArray(nights)||!nights.length||
    nights.some(day=>typeof day!=='string'||!DATE.test(day)))
  return unavailable('Published booking pricing is not available');

 const breakdown=[],snapshots=[];
 let total=0,minimumNights=1;
 for(const unit of units){
  const record=await readSetting(db,table,'pricing',unit); // strongly consistent
  const value=record?.value;
  if(!record||!value||!Array.isArray(value.bands)||!value.bands.length||
     !Number.isInteger(value.maxNights)||value.maxNights<1||
     nights.length>value.maxNights||record.version===undefined)
   return unavailable('Published pricing is missing or the stay is too long');

  let subtotal=0,required=1;
  for(const night of nights){
   const matching=value.bands.filter(b=>b&&b.start<=night&&night<b.end);
   if(matching.length!==1)return unavailable('Published pricing does not cover these dates');
   const band=matching[0],pence=pennies(band.nightlyGBP);
   if(pence===null||!Number.isInteger(band.minNights)||band.minNights<1||
      band.minNights>value.maxNights)
    return unavailable('Published nightly rate or minimum stay is invalid');
   subtotal+=pence;required=Math.max(required,band.minNights);
  }
  if(nights.length<required)return unavailable('Stay is shorter than the published minimum');
  total+=subtotal;minimumNights=Math.max(minimumNights,required);
  const amountGBP=(subtotal/100).toFixed(2);
  breakdown.push({unit,amountGBP});
  snapshots.push({unit,priceGBP:amountGBP,version:record.version});
 }
 return {currency:'GBP',totalGBP:(total/100).toFixed(2),breakdown,units:snapshots,
  nights:nights.length,minimumNights,status:'PUBLISHED_CONFIG_VERIFIED'};
}
