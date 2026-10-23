import { randomUUID } from 'node:crypto';
import {DAY,parseDate,validBooking} from './rules.mjs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,BatchGetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {SESClient,SendEmailCommand} from '@aws-sdk/client-ses';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const ses=new SESClient({});
const table=process.env.BOOKINGS_TABLE;
const origin=process.env.ALLOWED_ORIGIN||'https://lesbuttes.com';

function response(statusCode,body,headers={}){
  return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':origin,'Cache-Control':'no-store',...headers},body:typeof body==='string'?body:JSON.stringify(body)};
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
  return found.every(slot=>!slot.expiresAt||slot.expiresAt>0&&slot.expiresAt<now);
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
  // SES sender must be verified and the account must have permission to email the recipient.
  const from=process.env.NOTIFY_FROM,to=process.env.NOTIFY_TO;
  if(!from||!to)throw Error('Owner notification email is not configured');
  const body=[
    'A new Les Buttes booking request requires review. No booking is confirmed.',
    'Reference: '+booking.id,
    'Property: '+booking.unit,
    'Dates: '+booking.start+' to '+booking.end+' (departure)',
    'Guests: '+booking.guests,
    'Name: '+booking.guestName,
    'Email: '+booking.guestEmail,
    'Notes: '+(booking.notes||'None'),
    'Review the request against confirmed Airbnb reservations before approving.',
    'Only send a SumUp payment link after approval. Record confirmation after verifying payment.'
  ].join('\n');
  await ses.send(new SendEmailCommand({Source:from,Destination:{ToAddresses:[to]},Message:{Subject:{Data:'Les Buttes request '+booking.id},Body:{Text:{Data:body}}}}));
}
async function createRequest(input,event){
  if(input.website)return response(202,{received:true});
  const result=validBooking(input);
  if(result.error)return response(result.serverError?503:400,{error:result.error});
  const guestName=typeof input.name==='string'?input.name.trim():'';
  const guestEmail=typeof input.email==='string'?input.email.trim():'';
  const notes=typeof input.notes==='string'?input.notes.trim():'';
  if(guestName.length<2||guestName.length>120||guestEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)||notes.length>1500||input.consent!==true)return response(400,{error:'Invalid guest contact details or consent'});
  const verified=await verifyChallenge(input.turnstileToken,event.requestContext?.http?.sourceIp);
  if(!verified)return response(403,{error:'Verification failed'});
  const id=randomUUID();
  const requestedAt=new Date().toISOString();
  const expiresAt=nowEpoch()+24*60*60;
  const item={PK:'BOOKING#'+id,SK:'META',id,unit:input.unit,units:result.units,start:input.start,end:input.end,guests:input.guests,guestName,guestEmail,notes,status:'REQUESTED',requestedAt,holdExpiresAt:expiresAt,expiresAt:nowEpoch()+90*86400};
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
function escapeICS(value){return String(value).replace(/[\\,;]/g,'\\$&').replace(/\n/g,'\\n');}
function icsDate(yyyyMMdd){return yyyyMMdd.replaceAll('-','');}
async function calendar(cottage,token){
  if(!['geranium','honeysuckle'].includes(cottage)||!process.env.CALENDAR_TOKEN||token!==process.env.CALENDAR_TOKEN)return response(404,{error:'Not found'});
  const start=new Date().toISOString().slice(0,10);
  const end=new Date(Date.now()+730*DAY).toISOString().slice(0,10);
  const rows=[];
  let next;
  do{
    const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'PK = :pk AND SK BETWEEN :start AND :end',ExpressionAttributeValues:{':pk':'UNIT#'+cottage,':start':'DATE#'+start,':end':'DATE#'+end},ExclusiveStartKey:next,ConsistentRead:true}));
    rows.push(...result.Items??[]);next=result.LastEvaluatedKey;
  }while(next);
  const now=nowEpoch();
  const active=rows.filter(item=>!item.expiresAt||item.expiresAt>now).map(item=>item.SK.slice(5)).sort();
  // Consolidate contiguous occupied nights into one event per occupied period.
  const spans=[];
  for(const night of active){
    const last=spans[spans.length-1];
    if(last&&new Date(parseDate(last.end)+DAY).toISOString().slice(0,10)===night)last.end=night;
    else spans.push({start:night,end:night});
  }
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Les Buttes//Booking Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Les Buttes '+cottage];
  for(const s of spans){
    const departure=new Date(parseDate(s.end)+DAY).toISOString().slice(0,10);
    lines.push('BEGIN:VEVENT','UID:'+escapeICS(cottage+'-'+s.start+'@lesbuttes.com'),'DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),
      'DTSTART;VALUE=DATE:'+icsDate(s.start),'DTEND;VALUE=DATE:'+icsDate(departure),
      'SUMMARY:Unavailable','END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return response(200,lines.join('\r\n')+'\r\n',{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-cache, no-store'});
}
export async function handler(event){
  const path=event.rawPath||'';
  const method=event.requestContext?.http?.method||event.httpMethod;
  if(method==='OPTIONS')return response(204,'');
  if(method==='GET'&&path==='/health')return response(200,{status:'ok',acceptingRequests:process.env.BOOKING_REQUESTS_ENABLED==='true'});
  if(method==='GET'&&path.startsWith('/calendar/')){
    const match=path.match(/^\/calendar\/([^/]+)\/(geranium|honeysuckle)\.ics$/);
    return match?calendar(match[2],match[1]):response(404,{error:'Not found'});
  }
  if((method==='POST'&&path==='/requests')||(method==='GET'&&path==='/availability')){
    if(process.env.BOOKING_REQUESTS_ENABLED!=='true')return response(503,{error:'Direct booking requests are not open yet'});
    if(!table||!process.env.NOTIFY_FROM||!process.env.NOTIFY_TO||!process.env.TURNSTILE_SECRET)return response(503,{error:'Service not configured'});
    try{
      if(method==='POST'){
        if(Number(event.headers?.['content-length']||0)>10000)return response(413,{error:'Request too large'});
        let input;try{input=JSON.parse(event.body||'{}');}catch{return response(400,{error:'Invalid request'});}
        return await createRequest(input,event);
      }
      const q=event.queryStringParameters||{};
      const result=validBooking({unit:q.unit,start:q.start,end:q.end,guests:Number(q.guests)});
      if(result.error)return response(result.serverError?503:400,{available:false,error:result.error});
      return response(200,{available:await available(result.units,result.nights)});
    }catch(e){console.error('Booking API error',e);return response(500,{error:'Unable to check availability currently'});}
  }
  return response(404,{error:'Not found'});
}
