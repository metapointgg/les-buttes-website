// Private, NOT DEPLOYED guest preflight entry. No event source or DynamoDB writes.
// Terms provider is deliberately unavailable until CMS-published policies are connected.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createGuestSubmissionHandler} from './guest-submission-handler.mjs';
import {makeGuestPreflightProviders} from './guest-preflight-providers.mjs';
import {createCloudflareSiteverify} from './cloudflare-siteverify.mjs';

const unavailableTerms=async()=>{throw Error('Published CMS booking terms not connected');};
export function createPrivatePreflightEntry({db,siteverify,readPublishedTerms=unavailableTerms,
 table,turnstileSecret,hostname}={}){
 const providers=makeGuestPreflightProviders({db,table,siteverify,
  turnstileSecret,expectedHostname:hostname,readPublishedTerms});
 return createGuestSubmissionHandler(providers);
}
export async function handler(event){
 if(process.env.BOOKING_SUBMISSION_PREFLIGHT_ENABLED!=='true' ||
    process.env.BOOKING_REAL_GUEST_WRITES!=='false' ||
    process.env.BOOKING_ENVIRONMENT!=='staging')
  return {statusCode:403,body:'{"error":"Guest submission endpoint disabled"}'};
 // Never accept secrets or authorisation decisions from the event.
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
 const siteverify=createCloudflareSiteverify();
 try{
  const entry=createPrivatePreflightEntry({db,siteverify,
   table:process.env.BOOKINGS_TABLE,
   turnstileSecret:process.env.BOOKING_TURNSTILE_SECRET,
   hostname:process.env.BOOKING_TURNSTILE_HOSTNAME});
  return await entry(event);
 }catch{
  return {statusCode:503,body:'{"error":"Booking preflight unavailable"}'};
 }
}
