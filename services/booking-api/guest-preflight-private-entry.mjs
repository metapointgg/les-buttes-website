// Dedicated private preflight Lambda. NO public route, NO booking writes.
// Fails closed until an approved, immutable CMS terms release exists in staging.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {SSMClient} from '@aws-sdk/client-ssm';
import {createGuestSubmissionHandler} from './guest-submission-handler.mjs';
import {makeGuestPreflightProviders} from './guest-preflight-providers.mjs';
import {createCloudflareSiteverify} from './cloudflare-siteverify.mjs';
import {readApprovedTermsFromMaster} from './booking-terms-store.mjs';
import {readTurnstileSecret,TURNSTILE_PARAMETER} from './booking-turnstile-secret.mjs';

const unavailableTerms=async()=>{throw Error('Published CMS booking terms not connected');};
export function createPrivatePreflightEntry({db,siteverify,readPublishedTerms=unavailableTerms,
 table,turnstileSecret,hostname}={}){
 const providers=makeGuestPreflightProviders({db,table,siteverify,
  turnstileSecret,expectedHostname:hostname,readPublishedTerms});
 return createGuestSubmissionHandler(providers);
}
export async function handler(event={}){
 if(process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED!=='true' ||
    process.env.BOOKING_REAL_GUEST_WRITES!=='false' ||
    process.env.BOOKING_ENVIRONMENT!=='staging')
  return {statusCode:403,body:'{"error":"Guest submission endpoint disabled"}'};
 if((event.requestContext?.http?.method??event.httpMethod)!=='POST' ||
    (event.rawPath??event.path)!=='/real-booking-preflight')
  return {statusCode:404,body:'{"error":"Not found"}'};
 // Secrets, policy digests and published prices are all fetched server-side.
 // Never accept any of these from the guest event.
 try{
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
  const terms=await readApprovedTermsFromMaster({db,table:process.env.BOOKINGS_TABLE});
  if(process.env.BOOKING_TURNSTILE_SECRET_PARAMETER!==TURNSTILE_PARAMETER)
   throw Error('Missing Turnstile secret location');
  const ssm=new SSMClient({region:'eu-west-2'});
  const turnstileSecret=await readTurnstileSecret({ssm,
   name:process.env.BOOKING_TURNSTILE_SECRET_PARAMETER});
  const siteverify=createCloudflareSiteverify();
  const entry=createPrivatePreflightEntry({db,siteverify,
   readPublishedTerms:async()=>terms,
   table:process.env.BOOKINGS_TABLE,turnstileSecret,
   hostname:process.env.BOOKING_TURNSTILE_HOSTNAME});
  return await entry(event);
 }catch{
  // Do not disclose missing CMS terms, parameter values, tokens or AWS errors.
  return {statusCode:503,body:'{"error":"Booking preflight unavailable"}'};
 }
}
