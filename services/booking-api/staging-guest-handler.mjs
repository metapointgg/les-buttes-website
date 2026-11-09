import {requireAirbnbAvailability} from './airbnb-availability.mjs';
// Existing isolated guest API: synthetic staging only, no emails or payments.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {createStagingGuestRequest} from './staging-guest-request.mjs';
import {syntheticQuotaItems} from './staging-guest-quota.mjs';
import {quoteFromPublishedMaster} from './published-pricing.mjs';
import {dispatchRequestedBookingEmails} from './booking-confirmation-email-dispatch.mjs';
import {createStagingSesTransport} from './booking-staging-ses-transport.mjs';

const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
const ssm=new SSMClient({region:'eu-west-2'});
const origins=new Set(['http://localhost:4321','https://d123fnjf47zmyp.cloudfront.net']);
const testSecret='1x0000000000000000000000000000000AA'; // Public Cloudflare testing credential.
export function validChallengeResponse({secret,token,data,origin,testEnabled}){
 if(data?.success!==true)return false;
 if(secret===testSecret)return testEnabled===true&&token==='XXXX.DUMMY.TOKEN.XXXX'&&data.hostname==='example.com';
 return data.hostname===new URL(origin).hostname&&data.action==='lesbuttes-staging-booking';
}
export function createGuestHandler({db=client,parameterStore=ssm,fetchImpl=globalThis.fetch,env=process.env}={}){
 return async event=>{
  const table=env.BOOKINGS_TABLE,origin=event.headers?.origin??event.headers?.Origin??'';
  const allowed=env.ALLOWED_PREVIEW_ORIGIN;
  const respond=(statusCode,body)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store',
   ...(origin===allowed?{'access-control-allow-origin':allowed,'vary':'Origin'}:{})},body:JSON.stringify(body)});
  if(env.BOOKING_ENVIRONMENT!=='staging'||env.BOOKING_STAGING_GUEST_WRITES!=='true'||
     !/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??'')||!origins.has(allowed)||origin!==allowed)
   return respond(403,{error:'Staging submission disabled'});
  if(event.requestContext?.http?.method!=='POST'||event.rawPath!=='/request')return respond(404,{error:'Not found'});
  if(typeof event.body!=='string'||event.body.length>4096||event.isBase64Encoded)return respond(413,{error:'Request too large'});
  try{
   const payload=JSON.parse(event.body);
   const ip=event.requestContext?.http?.sourceIp;
   let quotaSecret;
   const readSecret=async()=>{
    const name=env.TURNSTILE_SECRET_PARAMETER;
    if(!/^\/les-buttes\/staging\/turnstile\/[A-Za-z0-9_-]+$/.test(name??''))throw Error('Secret unavailable');
    quotaSecret??=(await parameterStore.send(new GetParameterCommand({Name:name,WithDecryption:true}))).Parameter?.Value;
    if(typeof quotaSecret!=='string'||quotaSecret.length<10)throw Error('Secret unavailable');
    return quotaSecret;
   };
   const result=await createStagingGuestRequest({payload,
    verifyTurnstile:async token=>{
     const testEnabled=env.BOOKING_STAGING_TEST_CHALLENGE==='true';
     const secret=testEnabled?testSecret:await readSecret();
     const params=new URLSearchParams({secret,response:token});
     if(ip)params.set('remoteip',ip);
     const reply=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',body:params,signal:AbortSignal.timeout(7000)});
     return reply.ok&&validChallengeResponse({secret,token,data:await reply.json(),origin,testEnabled});
    },
    loadQuote:selection=>quoteFromPublishedMaster({db,table,...selection}),
    writeHold:async hold=>{
     const calendarChecks=env.BOOKING_AIRBNB_REQUIRED==='true'?await requireAirbnbAvailability({db,table,units:hold.meta.units,start:hold.meta.start,end:hold.meta.end}):[];
     return db.send(new TransactWriteCommand({TransactItems:[...calendarChecks,
     ...syntheticQuotaItems({table,ip,secret:await readSecret()}),
     ...hold.items.map(x=>({Put:{...x.Put,TableName:table}}))],ClientRequestToken:hold.meta.id}));}
   });
   let notificationStatus='DISABLED';
   if(env.BOOKING_REQUEST_DISPATCH_ENABLED==='true'){
    try{
     await dispatchRequestedBookingEmails({db,table,bookingId:result.reference,env,
      transport:createStagingSesTransport({env})});
     notificationStatus='ACCEPTED_OR_PREVIOUSLY_CLAIMED';
    }catch{
     notificationStatus='RECONCILIATION_REQUIRED';
     console.error('STAGING_REQUEST_NOTIFICATION_RECONCILIATION_REQUIRED',result.reference);
    }
   }
   return respond(201,{...result,notificationStatus});
  }catch(error){
   if(error.message==='Airbnb dates unavailable')return respond(409,{error:'Dates unavailable'});
   if(error.name==='TransactionCanceledException')return respond(409,{error:'Dates unavailable or staging request limit reached'});
   if(error.message==='Verification failed')return respond(403,{error:'Human verification required'});
   if(error.message==='Published quote unavailable')return respond(503,{error:'Published price unavailable'});
   if(error instanceof SyntaxError||/^(Invalid|Synthetic|Unexpected)/.test(error.message))return respond(400,{error:'Invalid synthetic booking request'});
   console.error('STAGING_REQUEST_FAILED',error.name);
   return respond(503,{error:'Staging submission temporarily unavailable'});
  }
 };
}
export const handler=createGuestHandler();
