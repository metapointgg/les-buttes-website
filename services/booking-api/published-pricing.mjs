// All new direct-booking quotations use the same published pricing arithmetic
// as the already deployed read-only quote service, and the same DynamoDB
// CURRENT records managed by the existing Les Buttes management application.
import {readSetting} from './booking-settings.mjs';
import {quotePublishedBands} from './published-band-quote.mjs';

const COTTAGES=new Set(['geranium','honeysuckle']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY=86400000;
const unavailable=error=>({error,serverError:true});
const nextDate=value=>new Date(Date.parse(value+'T00:00:00Z')+DAY).toISOString().slice(0,10);

function isConsecutiveNights(nights){
 if(!Array.isArray(nights)||!nights.length||nights.length>27)return false;
 for(let i=0;i<nights.length;i++){
  const day=nights[i],time=typeof day==='string'&&DATE.test(day)?Date.parse(day+'T00:00:00Z'):NaN;
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==day)return false;
  if(i>0&&nextDate(nights[i-1])!==day)return false;
 }
 return true;
}
const toPence=value=>{
 if(typeof value!=='string'||!/^\d+\.\d{2}$/.test(value))return null;
 const [whole,pence]=value.split('.');
 const sum=Number(whole)*100+Number(pence);
 return Number.isSafeInteger(sum)&&sum>0?sum:null;
};

export async function quoteFromPublishedMaster({db,table,units,nights}={}){
 if(!db?.send||!table||!Array.isArray(units)||!units.length||
    new Set(units).size!==units.length||units.some(x=>!COTTAGES.has(x))||
    !isConsecutiveNights(nights))
  return unavailable('Published booking pricing is not available');

 const start=nights[0],end=nextDate(nights[nights.length-1]);
 const breakdown=[],snapshots=[];
 let totalPence=0,minimumNights=1;
 for(const unit of units){
  const record=await readSetting(db,table,'pricing',unit); // ConsistentRead=true
  if(!record?.value||record.version===undefined)
   return unavailable('A published cottage price is missing');

  let quote;
  try{quote=quotePublishedBands(unit,start,end,record.value);}
  catch{return unavailable('The published price cannot quote the selected dates');}
  const pence=toPence(quote.totalGBP);
  if(pence===null)return unavailable('Published quotation amount is invalid');
  totalPence+=pence;

  // The common quote calculator has already checked each band's validity.
  // Preserve the effective minimum stay in the immutable booking quote.
  for(const night of nights){
   const band=record.value.bands.find(item=>item.start<=night&&night<item.end);
   minimumNights=Math.max(minimumNights,band.minNights);
  }
  breakdown.push({unit,amountGBP:quote.totalGBP});
  snapshots.push({unit,priceGBP:quote.totalGBP,version:record.version});
 }
 if(!Number.isSafeInteger(totalPence))return unavailable('Published quotation total is invalid');
 return {currency:'GBP',totalGBP:(totalPence/100).toFixed(2),breakdown,units:snapshots,
  nights:nights.length,minimumNights,status:'PUBLISHED_CONFIG_VERIFIED'};
}
