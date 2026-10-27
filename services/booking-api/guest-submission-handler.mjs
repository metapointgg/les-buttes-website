// Future protected submission handler: integration seam only, deliberately disabled.
// Does not expose an HTTP route, write DynamoDB, invoke KMS, email or process payment.
// Dependency injection ensures snapshots/terms/Turnstile are obtained on the server.
import {preflightGuestSubmission} from './guest-submission-preflight.mjs';

const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(statusCode,error)=>({statusCode,headers,body:JSON.stringify({error})});
const pickHeader=(headers,name)=>{
 const entries=Object.entries(headers??{}).filter(([k])=>k.toLowerCase()===name);
 return entries.length===1&&typeof entries[0][1]==='string'?entries[0][1]:null;
};
export function createGuestSubmissionHandler({readAvailability,readPricing,readTerms,verifyTurnstile}={}){
 return async function handler(event={}){
  // Neither environment config nor an arbitrary event payload can enable writes.
  if(process.env.BOOKING_ENVIRONMENT!=='staging' ||
    process.env.BOOKING_REAL_GUEST_WRITES!=='false' ||
    process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED!=='true')
   return reply(403,'Guest submission endpoint disabled');
  const method=event.requestContext?.http?.method??event.httpMethod;
  if(method!=='POST'||(event.rawPath??event.path)!=='/real-booking-preflight')
   return reply(404,'Not found');
  if(![readAvailability,readPricing,readTerms,verifyTurnstile].every(x=>typeof x==='function'))
   return reply(503,'Booking preflight unavailable');
  if(event.isBase64Encoded===true || typeof event.body!=='string')return reply(400,'Invalid submission');
  const origin=pickHeader(event.headers,'origin');
  // Origin is defence-in-depth, never authentication. Exact match only.
  if(!origin||origin!==process.env.BOOKING_ALLOWED_ORIGIN)return reply(403,'Origin not permitted');
  const key=pickHeader(event.headers,'idempotency-key');
  const contentType=pickHeader(event.headers,'content-type');
  const token=pickHeader(event.headers,'cf-turnstile-response');
  if(!token||token.length>2048)return reply(400,'Invalid submission');
  try{
   // No data is persisted. Every provider must fail closed on stale/missing data.
   const verified=await verifyTurnstile(token,{origin});
   if(verified!==true)return reply(400,'Invalid submission');
   const [availability,pricing,terms]=await Promise.all([
    readAvailability(),readPricing(),readTerms()
   ]);
   const result=preflightGuestSubmission({body:event.body,contentType,
    requestKey:key,turnstileVerified:verified,availability,pricing,terms});
   // Return safe quote only; never return name, email, notes, scope or fingerprint.
   return {statusCode:200,headers,body:JSON.stringify({status:'PREFLIGHT_ONLY',
    ...result.safeSummary,submissionEnabled:false})};
  }catch{
   return reply(400,'Submission could not be validated');
  }
 };
}
export const handler=createGuestSubmissionHandler();
