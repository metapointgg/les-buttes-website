// Preflight contract for a FUTURE protected guest submission endpoint.
// No AWS calls, HTTP listener, writes, KMS calls, notifications or payment actions.
// Actual API must obtain availability, published pricing and published terms from trusted
// server-side sources; never trust prices/terms returned by the browser.
import {createHash} from 'node:crypto';
import {validateRealRequestDraft} from './real-request-contract.mjs';
import {quoteFromSnapshots} from './public-quote.mjs';

const SECRET=/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/;
const MAX_BODY_BYTES=8192;
const hash=value=>createHash('sha256').update(value).digest('hex');

export function preflightGuestSubmission({body,contentType='application/json',
 terms,availability,pricing,requestKey,turnstileVerified=false}){
 if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>MAX_BODY_BYTES||body.length===0)
  throw Error('Invalid submission body');
 if(typeof contentType!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim()))
  throw Error('JSON content type required');
 if(!SECRET.test(requestKey??''))throw Error('Invalid request key');
 // This is a verified server-side result, not a guest-submitted boolean.
 if(turnstileVerified!==true)throw Error('Anti-bot verification required');
 let request;
 try{request=JSON.parse(body);}catch{throw Error('Invalid JSON');}
 if(!request||Array.isArray(request)||typeof request!=='object')throw Error('Invalid request');
 const allowed=new Set(['unit','start','end','adults','children','firstName','lastName',
  'email','telephone','notes','acceptedTerms','acceptedCancellation',
  'acceptedTermsVersion','acceptedTermsDigest','marketingConsent']);
 if(Object.keys(request).some(key=>!allowed.has(key)))throw Error('Unexpected submission fields');
 const guest=validateRealRequestDraft(request,terms);
 const quote=quoteFromSnapshots({availability,pricing,unit:guest.unit,start:guest.start,
  end:guest.end,adults:guest.adults,children:guest.children});
 const scope=hash('real-booking-request:'+requestKey);
 const payloadFingerprint=hash(JSON.stringify({
  unit:guest.unit,start:guest.start,end:guest.end,adults:guest.adults,children:guest.children,
  contact:[guest.guestName,guest.guestEmail,guest.guestTelephone,guest.notes],
  acceptance:guest.agreement
 }));
 return Object.freeze({
  mode:'PREFLIGHT_ONLY',request,quote,scope,payloadFingerprint,
  // Deliberately not a ready-to-write transaction.
  safeSummary:Object.freeze({unit:guest.unit,start:guest.start,end:guest.end,
   nights:quote.nights,totalGBP:quote.totalGBP})
 });
}
