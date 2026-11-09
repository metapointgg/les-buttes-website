// Synthetic staging requests use the same published quote as the booking API.
// Guest details are restricted to a test identity before any database write.
import {randomUUID} from 'node:crypto';
import {dates,guernseyToday} from './rules.mjs';
import {validateQuoteQuery} from './staging-quote-handler.mjs';

const fields=new Set(['unit','start','end','adults','children','firstName','lastName','email','telephone','notes','turnstileToken','consent']);
export async function createStagingGuestRequest({payload,verifyTurnstile,loadQuote,writeHold,now=Date.now()}){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!fields.has(k)))throw Error('Invalid request');
 if(payload.email!=='test@example.invalid'||payload.consent!==true)throw Error('Synthetic identity and consent required');
 const {unit,start,end,adults,children,turnstileToken}=payload;
 if(!Number.isInteger(adults)||!Number.isInteger(children)||adults<1||children<0)throw Error('Invalid party');
 const {units}=validateQuoteQuery({unit,start,end,guests:adults+children});
 const nights=dates(start,end);
 if(!nights||start<guernseyToday(new Date(now))||nights.length%7!==0||new Date(start+'T00:00:00Z').getUTCDay()!==6)throw Error('Invalid stay');
 if(typeof payload.firstName!=='string'||!payload.firstName.trim()||payload.firstName.length>80||
    typeof payload.lastName!=='string'||!payload.lastName.trim()||payload.lastName.length>80||
    typeof payload.telephone!=='string'||payload.telephone.length>40||payload.telephone.replace(/\D/g,'').length<7||
    typeof (payload.notes??'')!=='string'||(payload.notes??'').length>1000)throw Error('Invalid guest details');
 if(typeof turnstileToken!=='string'||turnstileToken.length<10||turnstileToken.length>2048||!await verifyTurnstile(turnstileToken))throw Error('Verification failed');
 const quote=await loadQuote({units,nights});
 if(quote?.error||quote?.status!=='PUBLISHED_CONFIG_VERIFIED'||quote.currency!=='GBP'||
    quote.units?.length!==units.length||quote.units.some((q,i)=>q.unit!==units[i]||!Number.isInteger(q.version)||q.version<1))throw Error('Published quote unavailable');
 const id=randomUUID(),nowEpoch=Math.floor(now/1000),requestedAt=new Date(now).toISOString(),holdExpiresAt=nowEpoch+24*3600;
 const meta={PK:'BOOKING#'+id,SK:'META',GSI1PK:'BOOKING_REQUESTS',GSI1SK:requestedAt+'#'+id,
  id,unit,units,start,end,guests:adults+children,guestName:'Synthetic Staging Guest',guestEmail:'test@example.invalid',
  notes:'SYNTHETIC STAGING TEST - NO CUSTOMER',quote,source:'direct',reservationStatus:'PENDING_REVIEW',
  status:'REQUESTED',requestedAt,holdExpiresAt,expiresAt:nowEpoch+90*86400,synthetic:true};
 const items=[{Put:{Item:meta,ConditionExpression:'attribute_not_exists(PK)'}}];
 for(const cottage of units)for(const night of nights)items.push({Put:{
  Item:{PK:'UNIT#'+cottage,SK:'DATE#'+night,id,expiresAt:holdExpiresAt},
  ConditionExpression:'attribute_not_exists(PK) OR (attribute_exists(expiresAt) AND expiresAt < :now)',
  ExpressionAttributeValues:{':now':nowEpoch}}});
 await writeHold({meta,items});
 return {received:true,reference:id,status:'REQUESTED',synthetic:true,totalGBP:quote.totalGBP,
  pricingVersions:quote.units.map(({unit,version})=>({unit,version})),holdExpiresAt,bookingConfirmed:false};
}
