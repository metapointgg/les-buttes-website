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
export function guernseyToday(instant=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Guernsey',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const byType=Object.fromEntries(parts.filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
  return byType.year+'-'+byType.month+'-'+byType.day;
}
export function validBooking(input,approvedRules){
  const {unit,start,end,guests}=input;
  const nights=dates(start,end);
  if(!nights||!Object.hasOwn(unitNames,unit)||!Number.isInteger(guests)||guests<1||guests>capacities[unit])return {error:'Invalid dates or guest count (maximum stay: 27 nights)'};
  if(new Date(parseDate(start)).getUTCDay()!==6||
     new Date(parseDate(end)).getUTCDay()!==6||
     nights.length%7!==0)
    return {error:'Bookings must be Saturday to Saturday in complete weeks'};
  if(unit==='both'&&guests<=6)
    return {error:'Both cottages require more than six guests'};
  if(parseDate(start)<parseDate(guernseyToday()))return {error:'Arrival date is in the past'};
  let rules;
  try{rules=approvedRules===undefined?JSON.parse(process.env.BOOKING_RULES_JSON||'{}'):approvedRules;}
  catch{return {error:'Booking rules not configured',serverError:true};}
  // Never silently assume 3-night minimums or a season without explicit rules.
  if(!Array.isArray(rules.openSeasons)||!Array.isArray(rules.minimumStays)||!rules.openSeasons.length||!rules.minimumStays.length)return {error:'Booking rules not configured',serverError:true};
  if(nights.some(day=>!rules.openSeasons.some(r=>day>=r.start&&day<=r.end)))return {error:'Dates are outside the bookable season'};
  const minimums=nights.map(day=>rules.minimumStays.filter(r=>day>=r.start&&day<=r.end));
  if(minimums.some(rows=>rows.length!==1||!Number.isInteger(rows[0].nights)||
     rows[0].nights<1||rows[0].nights>27))
    return {error:'Minimum stays not configured for dates',serverError:true};
  const minimumNights=minimums.map(rows=>rows[0].nights);
  if(nights.length<Math.max(...minimumNights))return {error:'Stay is shorter than the seasonal minimum'};
  if(approvedRules!==undefined){
    const maximums=nights.map(day=>rules.maximumStays?.filter(r=>day>=r.start&&day<=r.end));
    if(maximums.some(rows=>!Array.isArray(rows)||rows.length!==1||
      !Number.isInteger(rows[0].nights)||rows[0].nights<1||rows[0].nights>27))
      return {error:'Maximum stays not configured for dates',serverError:true};
    if(nights.length>Math.min(...maximums.map(rows=>rows[0].nights)))
      return {error:'Stay exceeds the published maximum'};
  }
  return {nights,units:unitNames[unit]};
}
