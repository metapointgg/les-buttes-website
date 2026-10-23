export const DAY=86400000;
const capacities={geranium:4,honeysuckle:6,both:10};
const unitNames={geranium:['geranium'],honeysuckle:['honeysuckle'],both:['geranium','honeysuckle']};
const datePattern=/^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value){
  if(typeof value!=='string'||!datePattern.test(value))return NaN;
  const d=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===value?d:NaN;
}
export function dates(start,end){
  const a=parseDate(start),b=parseDate(end);
  if(!Number.isFinite(a)||!Number.isFinite(b))return null;
  const nights=(b-a)/DAY;
  if(!Number.isInteger(nights)||nights<1||nights>27)return null;
  return Array.from({length:nights},(_,i)=>new Date(a+i*DAY).toISOString().slice(0,10));
}
export function validBooking(input){
  const {unit,start,end,guests}=input;
  const nights=dates(start,end);
  if(!nights||!(unit in unitNames)||!Number.isInteger(guests)||guests<1||guests>capacities[unit])return {error:'Invalid dates or guest count (maximum stay: 27 nights)'};
  if(parseDate(start)<Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'))return {error:'Arrival date is in the past'};
  let rules;
  try{rules=JSON.parse(process.env.BOOKING_RULES_JSON||'{}');}catch{return {error:'Booking rules not configured',serverError:true};}
  // Never silently assume 3-night minimums or a season without explicit rules.
  if(!Array.isArray(rules.openSeasons)||!Array.isArray(rules.minimumStays)||!rules.openSeasons.length||!rules.minimumStays.length)return {error:'Booking rules not configured',serverError:true};
  if(nights.some(day=>!rules.openSeasons.some(r=>day>=r.start&&day<=r.end)))return {error:'Dates are outside the bookable season'};
  const minimums=nights.map(day=>rules.minimumStays.find(r=>day>=r.start&&day<=r.end)?.nights);
  if(minimums.some(n=>!Number.isInteger(n)||n<1||n>27))return {error:'Minimum stays not configured for dates',serverError:true};
  if(nights.length<Math.max(...minimums))return {error:'Stay is shorter than the seasonal minimum'};
  return {nights,units:unitNames[unit]};
}
