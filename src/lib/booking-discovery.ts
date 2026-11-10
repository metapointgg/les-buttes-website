import preview from '../data/booking-preview-2027.json';
import {previewBookingQuote} from './booking-preview';

export type CottageUnit='geranium'|'honeysuckle';
export type CottageChoice=CottageUnit|'both';
export type SearchFilters={adults:number;children:number;bedrooms:number;choice:'any'|'both'};
export type CalendarDay={date:string;status:'closed'|'occupied'|'possible'|'unknown';rateGBP:number|null};
export type CottageCandidate={unit:CottageChoice;maxGuests:number;bedrooms:number;listedAs:'possible'|'occupied'|'not-checked'};
export const COTTAGES:readonly CottageUnit[]=['geranium','honeysuckle'] as const;
export type MasterAvailability={
  mode:'LIVE_STAGING_MASTER_READ_ONLY';capturedAt:string;
  firstNight:string;lastNight:string;lastCheckout:string;
  blocked:Record<CottageUnit,Array<{from:string;to:string}>>
};
let liveMaster:MasterAvailability|null=null;
// Fail closed: no 2026 snapshot fallback may masquerade as a live master.
export function masterConnected(){return liveMaster!==null;}
export function masterCheckedAt(){return liveMaster?.capturedAt??null;}
export function clearMasterAvailability(){liveMaster=null;}
export function setMasterAvailability(value:unknown){
  if(!value||typeof value!=='object')throw Error('masterUnavailable');
  const v=value as MasterAvailability;
  if(v.mode!=='LIVE_STAGING_MASTER_READ_ONLY'||v.firstNight!==preview.firstNight||
    v.lastNight!==preview.lastNight||v.lastCheckout!==preview.lastCheckout||
    !v.blocked||typeof v.capturedAt!=='string'||!Number.isFinite(Date.parse(v.capturedAt))||
    Math.abs(Date.now()-Date.parse(v.capturedAt))>120000)throw Error('masterUnavailable');
  for(const unit of COTTAGES){
    if(!Array.isArray(v.blocked[unit])||v.blocked[unit].length>196)throw Error('masterUnavailable');
    let end='';
    for(const row of v.blocked[unit]){
      if(typeof row.from!=='string'||typeof row.to!=='string'||!Number.isFinite(parseISO(row.from))||
        !Number.isFinite(parseISO(row.to))||row.from<preview.firstNight||
        row.to>preview.lastCheckout||row.from>=row.to||row.from<end)throw Error('masterUnavailable');
      end=row.to;
    }
  }
  liveMaster=v;
}

const DAY=86400000;
const limits:Record<CottageChoice,{maxGuests:number;bedrooms:number}>={
  geranium:preview.cottages.geranium,
  honeysuckle:preview.cottages.honeysuckle,
  both:{maxGuests:10,bedrooms:5}
};
export function parseISO(date:string):number{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NaN;
  const t=Date.parse(date+'T00:00:00.000Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date?t:NaN;
}
export function isoFromUTC(t:number){return new Date(t).toISOString().slice(0,10);}
export function plusDays(date:string,n:number){const t=parseISO(date);if(!Number.isFinite(t))throw Error('invalidDates');return isoFromUTC(t+n*DAY);}
export function getCapacity(choice:CottageChoice){return limits[choice];}
export function matchingCottages(filters:SearchFilters):CottageChoice[]{
  const {adults,children,bedrooms,choice}=filters;
  if(!Number.isInteger(adults)||adults<1||!Number.isInteger(children)||children<0||
    !Number.isInteger(bedrooms)||bedrooms<0||bedrooms>5)return [];
  const guests=adults+children;
  if(guests>10||guests<1)return [];
  if(choice==='both')return guests<=10&&bedrooms<=5?['both']:[];
  if(choice!=='any')return [];
  const single=COTTAGES.filter(unit=>guests<=limits[unit].maxGuests&&bedrooms<=limits[unit].bedrooms);
  // Two cottages are necessary for a party of 7-10 or 4-5 bedrooms.
  return single.length?single:['both'];
}
export function hasOccupiedNight(unit:CottageUnit,date:string):boolean{
  if(!liveMaster)throw Error('masterUnavailable');
  return liveMaster.blocked[unit].some(block=>date>=block.from&&date<block.to);
}
export function cottageNightBlocked(unit:CottageChoice,date:string):boolean{
  return unit==='both'?COTTAGES.some(c=>hasOccupiedNight(c,date)):hasOccupiedNight(unit,date);
}
export function possibleNight(unit:CottageChoice,date:string):boolean{
  return Boolean(liveMaster)&&date>=preview.firstNight&&date<=preview.lastNight&&!cottageNightBlocked(unit,date);
}
export function nightsInRange(start:string,end:string):string[]{
  const a=parseISO(start),b=parseISO(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)throw Error('invalidDates');
  const count=(b-a)/DAY;
  if(!Number.isInteger(count)||count<1||count>27)throw Error('invalidDates');
  if(start<preview.firstNight||end>preview.lastCheckout)throw Error('outsideSeason');
  return Array.from({length:count},(_,i)=>isoFromUTC(a+i*DAY));
}
export function referenceAllows(unit:CottageChoice,start:string,end:string):boolean{
  const nights=nightsInRange(start,end);
  return nights.every(date=>possibleNight(unit,date));
}
export function minimumFor(start:string,end:string):number{
  const nights=nightsInRange(start,end);
  return Math.max(...nights.map(date=>{
    const rows=preview.proposedMinimumStays.filter(x=>date>=x.from&&date<=x.to);
    if(rows.length!==1)throw Error('unavailableQuote');
    return rows[0].nights;
  }));
}
export function matchingOptions(filters:SearchFilters,start?:string,end?:string):CottageCandidate[]{
  return matchingCottages(filters).map(unit=>{
    let status:CottageCandidate['listedAs']='not-checked';
    if(start&&end&&liveMaster){
      try{status=referenceAllows(unit,start,end)?'possible':'occupied';}
      catch{status='occupied';}
    }
    return {unit,...getCapacity(unit),listedAs:status};
  });
}
export function dayPrice(unit:CottageUnit,date:string):number|null{
  const rows=preview.nights[unit].filter(x=>date>=x.from&&date<=x.to);
  return rows.length===1?rows[0].gbp:null;
}
export function daysForMonth(unit:CottageUnit,month:string):CalendarDay[]{
  if(!/^\d{4}-\d{2}$/.test(month))throw Error('invalidDates');
  const first=parseISO(month+'-01');
  if(!Number.isFinite(first))throw Error('invalidDates');
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).getTime();
  return Array.from({length:(end-first)/DAY},(_,i)=>{
    const date=isoFromUTC(first+i*DAY);
    const rateGBP=dayPrice(unit,date);
    return {
      date,
      status:date<preview.firstNight||date>preview.lastNight?'closed':!liveMaster?'unknown':hasOccupiedNight(unit,date)?'occupied':'possible',
      rateGBP
    };
  });
}
export function canPickCheckout(unit:CottageChoice,start:string,checkout:string):boolean{
  try{return referenceAllows(unit,start,checkout);}
  catch{return false;}
}
export function indicativeSelection(unit:CottageChoice,start:string,end:string,filters:SearchFilters){
  if(!matchingCottages(filters).includes(unit))throw Error('capacity');
  if(!referenceAllows(unit,start,end))throw Error('occupied');
  const quote=previewBookingQuote(unit,start,end,filters.adults+filters.children);
  return {...quote,adults:filters.adults,children:filters.children,bedroomsRequested:filters.bedrooms};
}
