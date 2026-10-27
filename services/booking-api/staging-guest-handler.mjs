// Separate Lambda: no guest emails, payments or confirmation. Staging synthetic only.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createStagingGuestRequest} from './staging-guest-request.mjs';
import {masterOccupied} from './master-occupied.mjs';
import {publishedPricingSnapshots} from './published-pricing-reader.mjs';
const table=process.env.BOOKINGS_TABLE;
const region='eu-west-2';
const client=DynamoDBDocumentClient.from(new DynamoDBClient({region}));
const corsOrigin=process.env.ALLOWED_PREVIEW_ORIGIN;
const response=(statusCode,body,origin)=>({statusCode,headers:{
 'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 ...(origin===corsOrigin?{'Access-Control-Allow-Origin':corsOrigin,'Vary':'Origin'}:{})
 },body:JSON.stringify(body)});
async function verifyTurnstile(token,ip){
 const secret=process.env.TURNSTILE_SECRET;
 if(!secret||secret.length<10)return false;
 const params=new URLSearchParams({secret,response:token});
 if(ip)params.set('remoteip',ip);
 const reply=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(7000)});
 if(!reply.ok)return false;
 const data=await reply.json();
 return data.success===true && data.hostname==='localhost' && data.action==='lesbuttes-staging-booking';
}
export async function handler(event){
 const origin=event.headers?.origin??event.headers?.Origin??'';
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.BOOKING_STAGING_GUEST_WRITES!=='true'||
  !/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??'')||
  origin!==corsOrigin)return response(403,{error:'Staging submission disabled'},origin);
 if((event.requestContext?.http?.method??event.httpMethod)!=='POST'||(event.rawPath??event.path)!=='/request')
  return response(404,{error:'Not found'},origin);
 const length=Number(event.headers?.['content-length']??event.headers?.['Content-Length']??0);
 if(length>4096||typeof event.body!=='string'||event.body.length>4096||event.isBase64Encoded)
  return response(413,{error:'Request too large'},origin);
 try{
  const payload=JSON.parse(event.body);
  const result=await createStagingGuestRequest({payload,origin,ip:event.requestContext?.http?.sourceIp,
   verifyTurnstile,loadSnapshots:async()=>({
    availability:await masterOccupied({db:{send:x=>client.send(new QueryCommand(x.input))},table}),
    pricing:await publishedPricingSnapshots({db:{send:x=>client.send(new GetCommand(x))},table})
   }),
   writeHold:async hold=>client.send(new TransactWriteCommand({TransactItems:
    hold.items.map(x=>({Put:{...x.Put,TableName:table}})),ClientRequestToken:hold.meta.id}))
  });
  return response(201,result,origin);
 }catch(error){
  // Never include names, email addresses, token values or server errors in logs or responses.
  const message=String(error?.message||'');
  if(message==='Origin not allowed')return response(403,{error:'Not permitted'},origin);
  if(message==='Verification failed'||message==='Verification required')
   return response(403,{error:'Human verification required'},origin);
  if(message==='Dates occupied')return response(409,{error:'Dates no longer available'},origin);
  return response(400,{error:'Submission not accepted. Refresh availability and retry.'},origin);
 }
}
