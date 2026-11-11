// One-time owner acceptance: never changes the published Geranium rate.
import {timingSafeEqual} from 'node:crypto';
export const TEST_APPROVAL_PENCE=100;
export function controlledTestRequest(input){
 return input?.unit==='geranium'&&input.start==='2027-04-10'&&input.end==='2027-04-17'&&
  input.guests===2&&String(input.email??'').trim().toLowerCase()==='mike@un1ty.gg'&&
  input.website===''&&typeof input.name==='string'&&input.name.trim().length>=2;
}
export function controlledTestBooking(booking){
 return booking?.source==='direct'&&booking.synthetic!==true&&
  Array.isArray(booking.units)&&booking.units.length===1&&booking.units[0]==='geranium'&&
  booking.start==='2027-04-10'&&booking.end==='2027-04-17'&&
  String(booking.guestEmail??'').trim().toLowerCase()==='mike@un1ty.gg'&&
  booking.quote?.currency==='GBP'&&Number(booking.quote?.totalGBP)===735;
}
export function matchesControlledAccess(candidate,secret){
 if(typeof candidate!=='string'||typeof secret!=='string'||
  candidate.length<32||candidate.length>256||secret.length<32||secret.length>256)return false;
 const a=Buffer.from(candidate,'utf8'),b=Buffer.from(secret,'utf8');
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function controlledTestBookingClaim(table,bookingId){
 return {Put:{TableName:table,Item:{PK:'SYSTEM#PRODUCTION_TEST',SK:'GERANIUM#2027-04-10',bookingId},
  ConditionExpression:'attribute_not_exists(PK)'}};
}
