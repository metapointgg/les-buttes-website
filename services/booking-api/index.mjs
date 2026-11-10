import { randomUUID,timingSafeEqual } from 'node:crypto';
import {validBooking} from './rules.mjs';
import {quoteFromPublishedMaster} from './published-pricing.mjs';
import {slotBlocksAvailability} from './occupancy.mjs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,BatchGetCommand,GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {directCalendarPreview} from './direct-calendar-preview.mjs';
import {validateTermsAcceptance} from './booking-terms-acceptance.mjs';
import {dispatchRequestedProductionBookingEmails} from './booking-production-email-dispatch.mjs';
import {createProductionSesTransport} from './booking-production-ses-transport.mjs';
import {productionEmailGate} from './production-integration-gates.mjs';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const ssm=new SSMClient({});
const table=process.env.BOOKINGS_TABLE;
const calendarTokens=new Map();

function response(statusCode,body,headers={}){
  return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers},body:typeof body==='string'?body:JSON.stringify(body)};
}
function slotsFor(units,nights){return units.flatMap(unit=>nights.map(day=>({PK:'UNIT#'+unit,SK:'DATE#'+day})));}
async function existingSlots(slots){
  const keys=slots;
  const found=[];
  // Max 54 date slots for two cottages, within DynamoDB BatchGet 100-key limit.
  let pending=keys;
  for(let attempt=0;pending.length&&attempt<4;attempt++){
    const result=await db.send(new BatchGetCommand({RequestItems:{[table]:{Keys:pending,ConsistentRead:true}}}));
    found.push(...(result.Responses?.[table]??[]));
    pending=result.UnprocessedKeys?.[table]?.Keys??[];
  }
  if(pending.length)throw Error('Availability could not be verified');
  return found;
}
function nowEpoch(){return Math.floor(Date.now()/1000);}
async function available(units,nights){
  const found=await existingSlots(slotsFor(units,nights));
  const now=nowEpoch();
  return found.every(slot=>!slotBlocksAvailability(slot,now));
}
async function verifyChallenge(token,ip){
  const secret=process.env.TURNSTILE_SECRET;
  if(!secret||!token||typeof token!=='string'||token.length>2048)return false;
  const params=new URLSearchParams({secret,response:token});
  if(ip)params.set('remoteip',ip);
  const result=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:params,signal:AbortSignal.timeout(6000)});
  if(!result.ok)return false;
  return (await result.json()).success===true;
}
async function notifyOwner(booking){
  if(process.env.BOOKING_ENVIRONMENT==='staging'){
    console.info('STAGING ONLY: synthetic request created, no email dispatched:',booking.id);
    return;
  }
  if(!productionEmailGate(process.env))throw Error('Production request email integration disabled');
  await dispatchRequestedProductionBookingEmails({db,table,bookingId:booking.id,
    transport:createProductionSesTransport(),env:process.env});
}
async function createRequest(input,event){
  if(input.website)return response(202,{received:true});
  const result=validBooking(input);
  if(result.error)return response(result.serverError?503:400,{error:result.error});
  const quote=await quoteFromPublishedMaster({db,table,units:result.units,nights:result.nights});
  if(quote.error)return response(503,{error:quote.error});
  if(process.env.BOOKING_ENVIRONMENT==='staging' && input.email!=='test@example.invalid')return response(400,{error:'Use synthetic test@example.invalid data only in staging'});
  const guestName=typeof input.name==='string'?input.name.trim():'';
  const guestEmail=typeof input.email==='string'?input.email.trim():'';
  const guestTelephone=typeof input.telephone==='string'?input.telephone.trim():'';
  const notes=typeof input.notes==='string'?input.notes.trim():'';
  if(guestName.length<2||guestName.length>120||guestEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)||
    (process.env.BOOKING_ENVIRONMENT==='production'&&
      (guestTelephone.length<7||guestTelephone.length>40||!/^[+0-9() .-]+$/.test(guestTelephone)))||
    notes.length>1500||input.consent!==true)return response(400,{error:'Invalid guest contact details or consent'});
  const verified=await verifyChallenge(input.turnstileToken,event.requestContext?.http?.sourceIp);
  if(!verified)return response(403,{error:'Verification failed'});
  let termsEvidence={};
  if(process.env.BOOKING_ENVIRONMENT==='production'){
    try{
      const terms=(await db.send(new GetCommand({TableName:table,
        Key:{PK:'CONFIG#terms#all',SK:'CURRENT'},ConsistentRead:true}))).Item;
      termsEvidence=validateTermsAcceptance({acceptance:input.termsAcceptance,termsRecord:terms});
    }catch{return response(409,{error:'Current booking terms must be accepted'});}
  }
  const id=randomUUID();
  const requestedAt=new Date().toISOString();
  const expiresAt=nowEpoch()+24*60*60;
  const item={PK:'BOOKING#'+id,SK:'META',GSI1PK:'BOOKING_REQUESTS',GSI1SK:requestedAt+'#'+id,id,unit:input.unit,units:result.units,start:input.start,end:input.end,guests:input.guests,guestName,guestEmail,guestTelephone,notes,quote,source:'direct',...termsEvidence,
    ...(process.env.BOOKING_ENVIRONMENT==='staging'?{synthetic:true}:{}),
    reservationStatus:'PENDING_REVIEW',status:'REQUESTED',requestedAt,holdExpiresAt:expiresAt,expiresAt:nowEpoch()+90*86400};
  const transact=[{Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(PK)'}}];
  for(const key of slotsFor(result.units,result.nights))transact.push({Put:{TableName:table,Item:{...key,id,expiresAt},ConditionExpression:'attribute_not_exists(PK) OR expiresAt < :now',ExpressionAttributeValues:{':now':nowEpoch()}}});
  try{
    await db.send(new TransactWriteCommand({TransactItems:transact,ClientRequestToken:id}));
  }catch(e){
    if(e.name==='TransactionCanceledException')return response(409,{error:'Requested dates are no longer available'});
    throw e;
  }
  try{await notifyOwner(item);}catch(e){console.error('Booking request notification failed',id,e);}
  return response(202,{received:true,reference:id});
}
async function calendarTokenMatches(cottage,candidate){
 let expected=process.env[cottage.toUpperCase()+'_CALENDAR_TOKEN']??process.env.CALENDAR_TOKEN;
 const prefix=process.env.CALENDAR_TOKEN_SSM_PREFIX;
 if(!expected&&prefix){
  const name=prefix.replace(/\/+$/,'')+'/'+cottage+'-token';
  expected=calendarTokens.get(name);
  if(!expected){
   const result=await ssm.send(new GetParameterCommand({Name:name,WithDecryption:true}));
   expected=result.Parameter?.Value;
   if(typeof expected==='string'&&expected.length>=32)calendarTokens.set(name,expected);
  }
 }
 if(typeof candidate!=='string'||typeof expected!=='string'||candidate.length<24||candidate.length>256)return false;
 const a=Buffer.from(candidate),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
async function calendar(cottage,token){
  if(!['geranium','honeysuckle'].includes(cottage)||!await calendarTokenMatches(cottage,token))return response(404,{error:'Not found'});
  const result=await directCalendarPreview({db,table,unit:cottage});
  return response(200,result.calendar,{'Content-Type':'text/calendar; charset=utf-8',
    'Cache-Control':'private, no-cache, no-store, must-revalidate','X-Robots-Tag':'noindex, nofollow'});
}
export async function handler(event){
  const path=event.rawPath||'';
  const method=event.requestContext?.http?.method||event.httpMethod;
  const calendarMatch=method==='GET'?path.match(/^\/calendar\/([^/]+)\/(geranium|honeysuckle)\.ics$/):null;
  if(process.env.BOOKING_ENVIRONMENT==='staging'&&!calendarMatch){
    const incoming=event.headers?.['x-lesbuttes-staging-token']??event.headers?.['X-LesButtes-Staging-Token'];
    const expected=process.env.STAGING_API_TOKEN;
    if(!expected||expected.length<24||incoming!==expected)return response(404,{error:'Not found'});
  }
  if(method==='OPTIONS')return response(204,'');
  if(method==='GET'&&path==='/health')return response(200,{status:'ok',acceptingRequests:process.env.BOOKING_REQUESTS_ENABLED==='true'});
  if(method==='GET'&&path.startsWith('/calendar/')){
    if(!calendarMatch)return response(404,{error:'Not found'});
    try{return await calendar(calendarMatch[2],calendarMatch[1]);}
    catch(error){console.error('Outbound calendar generation failed',calendarMatch[2],error);return response(503,{error:'Calendar temporarily unavailable'});}
  }
  if((method==='POST'&&(path==='/requests'||path==='/request'))||(method==='GET'&&path==='/availability')){
    if(process.env.BOOKING_REQUESTS_ENABLED!=='true')return response(503,{error:'Direct booking requests are not open yet'});
    if(!table||!process.env.TURNSTILE_SECRET||
      (process.env.BOOKING_ENVIRONMENT!=='staging'&&!productionEmailGate(process.env)))
      return response(503,{error:'Service not configured'});
    // Published Cloudflare demo credentials may be used in the private staging stack only.
    if(process.env.BOOKING_ENVIRONMENT!=='staging'&&/^[123]x0000000000000000000000000000000AA$/.test(process.env.TURNSTILE_SECRET))return response(503,{error:'Production challenge verification is not configured'});
    try{
      if(method==='POST'){
        if((event.body?.length??0)>10000)return response(413,{error:'Request too large'});
        let input;try{input=JSON.parse(event.body||'{}');if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid request');}catch{return response(400,{error:'Invalid request'});}
        return await createRequest(input,event);
      }
      const q=event.queryStringParameters||{};
      const result=validBooking({unit:q.unit,start:q.start,end:q.end,guests:Number(q.guests)});
      if(result.error)return response(result.serverError?503:400,{available:false,error:result.error});
      const quote=await quoteFromPublishedMaster({db,table,units:result.units,nights:result.nights});
      if(quote.error)return response(503,{available:false,error:quote.error});
      const isAvailable=await available(result.units,result.nights);
      return response(200,{available:isAvailable,quote:isAvailable?quote:undefined});
    }catch(e){console.error('Booking API error',e);return response(500,{error:'Unable to check availability currently'});}
  }
  return response(404,{error:'Not found'});
}
