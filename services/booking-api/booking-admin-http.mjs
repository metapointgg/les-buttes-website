// Staging-only administration Lambda handler. Must be deployed behind API Gateway
// Cognito JWT authorizer. Do not expose directly or attach unauthenticated routes.
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {checkOwnerAction} from './booking-admin-action-policy.mjs';
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
export function createAdminHandler({reader}){
 return async event=>{
   try{
     if(event?.requestContext?.http?.method!=='GET')return reply(405,{error:'Method not allowed'});
     const id=identityFromGateway(event);
     if(!id)return reply(403,{error:'Forbidden'});
     const path=event.rawPath??'';
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
   deployedHandler=createAdminHandler({reader:createReadOnlyAdminReader({
     authorise:async request=>identityFromGateway(request)
   })});
 }
 return deployedHandler(event);
}
