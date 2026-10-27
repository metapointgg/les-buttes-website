// Server-only adapters for the future preflight route. No API exposure or writes.
// CMS terms remain intentionally unconfigured until the editorial CMS is ready.
import {QueryCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {masterOccupied} from './master-occupied.mjs';
import {publishedPricingSnapshots} from './published-pricing-reader.mjs';

const STAGING=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const HOST=/^[a-z0-9.-]+$/i;
export function makeGuestPreflightProviders({db,table,siteverify,turnstileSecret,
 expectedHostname,expectedAction='booking_preflight',readPublishedTerms}={}){
 if(!db||!STAGING.test(table??''))throw Error('Authoritative staging reader unavailable');
 const readAvailability=()=>masterOccupied({db:{send:({input})=>db.send(new QueryCommand(input))},table});
 const readPricing=()=>publishedPricingSnapshots({db:{send:x=>db.send(new GetCommand(x))},table});
 const readTerms=async()=>{
  if(typeof readPublishedTerms!=='function')throw Error('Published CMS terms unavailable');
  const terms=await readPublishedTerms();
  if(terms?.status!=='PUBLISHED'||!Number.isSafeInteger(terms.version)||terms.version<1||
    typeof terms.digest!=='string'||!/^[a-f0-9]{64}$/.test(terms.digest))
   throw Error('Published CMS terms unavailable');
  return {status:'PUBLISHED',version:terms.version,digest:terms.digest};
 };
 const verifyTurnstile=async(token)=>{
  if(typeof token!=='string'||token.length<1||token.length>2048||
     typeof turnstileSecret!=='string'||!turnstileSecret||
     typeof siteverify!=='function'||typeof expectedHostname!=='string'||
     !HOST.test(expectedHostname))return false;
  try{
   // Server adapter MUST POST secret and response to the real Cloudflare siteverify API.
   // siteverify is injected so this module cannot silently use a browser-supplied verdict.
   const outcome=await siteverify({secret:turnstileSecret,response:token});
   return outcome?.success===true&&outcome.hostname===expectedHostname&&
     outcome.action===expectedAction;
  }catch{return false;}
 };
 return {readAvailability,readPricing,readTerms,verifyTurnstile};
}
