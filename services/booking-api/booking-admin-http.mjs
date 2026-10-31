// Staging-only administration Lambda handler. Must be deployed behind API Gateway
// Cognito JWT authorizer. Do not expose directly or attach unauthenticated routes.
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {checkOwnerAction} from './booking-admin-action-policy.mjs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
const groups=(claims)=>{
 const raw=claims?.['cognito:groups']??[];
 return Array.isArray(raw)?raw:typeof raw==='string'?raw.split(',').map(v=>v.trim()):[];
};
export function identityFromGateway(event,{issuer=process.env.MANAGEMENT_COGNITO_ISSUER,clientId=process.env.MANAGEMENT_COGNITO_CLIENT_ID}={}){
 // Require an API Gateway VERIFIED Cognito *access* token. API Gateway checks
 // JWT signature, issuer and audience; the Lambda adds token-use and group checks.
 const jwt=event?.requestContext?.authorizer?.jwt;
 const claims=jwt?.claims;
 if(!issuer||!clientId||!claims||typeof claims.sub!=='string'||
    claims.token_use!=='access'||claims.iss!==issuer||claims.client_id!==clientId)return null;
 const roles=groups(claims);
 const role=roles.includes('lesbuttes-owner')?'owner':roles.includes('lesbuttes-admin')?'admin':roles.includes('lesbuttes-viewer')?'viewer':null;
 return role?{subject:claims.sub,role}:null;
}
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function createAdminHandler({reader,writeAction,writeEnabled=()=>false}){
 return async event=>{
   try{
     const method=event?.requestContext?.http?.method;
     if(method!=='GET'&&method!=='POST')return reply(405,{error:'Method not allowed'});
     const id=identityFromGateway(event);
     if(!id)return reply(403,{error:'Forbidden'});
     const path=event.rawPath??'';
     if(method==='POST'){
       const match=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/actions\/(approve|decline|cancel)$/i);
       if(!match)return reply(405,{error:'Method not allowed'});
       if(id.role!=='owner')return reply(403,{error:'Forbidden'});
       if(process.env.BOOKING_ENVIRONMENT!=='staging'||!process.env.BOOKINGS_TABLE?.toLowerCase().includes('staging')||
          !writeEnabled()||typeof writeAction!=='function')
         return reply(503,{error:'Management writes disabled'});
       if(event.isBase64Encoded||typeof event.body!=='string'||event.body.length>4096)
         return reply(400,{error:'Invalid request'});
       let payload;
       try{payload=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid request'});}
       if(!payload||typeof payload!=='object'||Array.isArray(payload))
         return reply(400,{error:'Invalid request'});
       if(match[2]==='approve')
         return reply(503,{error:'Approval requires verified payment integration'});
       if(Object.keys(payload).some(k=>k!=='reason')||
          typeof payload.reason!=='string'||payload.reason.trim().length<5||payload.reason.length>1000)
         return reply(400,{error:'A recorded reason is required'});
       try{
         const result=await writeAction({identity:id,bookingId:match[1],action:match[2],reason:payload.reason});
         return reply(200,result);
       }catch(e){
         if(e?.name==='TransactionCanceledException')return reply(409,{error:'Booking changed; refresh and retry'});
         if(/Forbidden/.test(e?.message??''))return reply(403,{error:'Forbidden'});
         if(/Invalid|expired|mismatch|requires|Only authoritative|Confirmed direct|status/.test(e?.message??''))
           return reply(409,{error:'Booking is no longer eligible for this action'});
         throw e;
       }
     }
     // Read-only preflight: no state mutation and no payment confirmation.
     // The future write API must use separate routes and IAM permissions.
     const preflight=path.split('/').length===7 && path.startsWith('/admin/bookings/') && path.endsWith('/preflight') ? (()=>{ const parts=path.split('/'); return /^[0-9a-f-]{36}$/i.test(parts[3]) && parts[4]==='actions' && ['approve','decline','cancel'].includes(parts[5]) ? [path,parts[3],parts[5]] : null; })() : null;
     if(preflight){
       const record=await reader.getBooking(event,preflight[1]);
       if(!record)return reply(404,{error:'Not found'});
       const decision=checkOwnerAction({identity:id,action:preflight[2],booking:record,
         reason:event.queryStringParameters?.reason});
       return reply(decision.allowed?200:403,{allowed:decision.allowed,
         ...(decision.allowed?{from:decision.from,to:decision.to}:{reason:decision.reason})});
     }

     let match=path.match(/^\/admin\/config\/(pricing|stay-rules|cancellation|payments|business|arrival-departure|terms)\/(geranium|honeysuckle|all)(\/versions)?$/);
     if(match){
       const data=match[3]?await reader.getConfigHistory(event,match[1],match[2]):await reader.getConfig(event,match[1],match[2]);
       return reply(200,data);
     }
     match=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/audit$/i);
     if(match){
       const limit=Number(event.queryStringParameters?.limit??30);
       const cursorRaw=event.queryStringParameters?.cursor;
       let cursor=null;
       if(cursorRaw){
         try{cursor=JSON.parse(Buffer.from(cursorRaw,'base64url').toString('utf8'));}
         catch{ return reply(400,{error:'Invalid cursor'}); }
       }
       const page=await reader.getBookingAudit(event,match[1],{limit,cursor});
       return reply(200,{items:page.items,
         nextCursor:page.nextCursor?Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'):null});
     }
     match=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})$/i);
     if(match){const data=await reader.getBooking(event,match[1]);return reply(data?200:404,data??{error:'Not found'});}
     if(path==='/admin/bookings'){
       const limit=Number(event.queryStringParameters?.limit??30);
       const data=await reader.listBookings(event,{limit});
       return reply(200,data);
     }
     return reply(404,{error:'Not found'});
   }catch(e){
     if(String(e?.message).includes('index not configured'))return reply(503,{error:'Booking index has not been deployed'});
     if(String(e?.message).includes('Unauthorised'))return reply(403,{error:'Forbidden'});
     if(String(e?.message).includes('Invalid'))return reply(400,{error:'Invalid request'});
     console.error('Admin read failed',e?.name??'Error');
     return reply(503,{error:'Booking management temporarily unavailable'});
   }
 };
}
// Lazy initialisation allows isolated test imports without AWS configuration.
let deployedHandler;
export async function handler(event){
 if(!deployedHandler){
   const staging=process.env.BOOKING_ENVIRONMENT==='staging'&&
     process.env.BOOKINGS_TABLE?.toLowerCase().includes('staging')&&
     process.env.MANAGEMENT_WRITES_ENABLED==='true';
   const table=process.env.BOOKINGS_TABLE;
   const db=staging?DynamoDBDocumentClient.from(new DynamoDBClient({}),
     {marshallOptions:{removeUndefinedValues:true}}):null;
   deployedHandler=createAdminHandler({
     reader:createReadOnlyAdminReader({authorise:async request=>identityFromGateway(request)}),
     writeEnabled:()=>staging,
     writeAction:staging?async args=>executeOwnerTransition({
       ...args,db,table,
       readBooking:async bookingId=>(await db.send(new GetCommand({
         TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true
       }))).Item??null
     }):undefined
   });
 }
 return deployedHandler(event);
}
