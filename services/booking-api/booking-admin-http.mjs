// Staging-only administration Lambda handler. Must be deployed behind API Gateway
// Cognito JWT authorizer. Do not expose directly or attach unauthenticated routes.
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {checkOwnerAction} from './booking-admin-action-policy.mjs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
import {publishOwnerConfiguration,rollbackOwnerConfiguration} from './booking-admin-config-writer.mjs';
import {checkoutRuntimeEnabled,registerCheckoutWithSandbox} from './booking-checkout-runtime.mjs';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {paymentReconciliationEnabled,reconcileOwnerSandboxPayment} from './booking-payment-reconciliation-runtime.mjs';
// API Gateway's HTTP JWT authorizer can stringify Cognito group arrays
// using either comma separators or spaces, with optional quoted members.
// Parse the entire claim; never use substring matching to grant a role.
const GROUP_NAME=/^[A-Za-z0-9_-]{1,64}$/;
const GROUP_TOKEN=/(?:"([A-Za-z0-9_-]{1,64})"|'([A-Za-z0-9_-]{1,64})'|([A-Za-z0-9_-]{1,64}))/y;
const parseGroupSequence=(raw)=>{
 const value=raw.trim(),result=[];
 if(!value)return [];
 let offset=0;
 while(offset<value.length){
  GROUP_TOKEN.lastIndex=offset;
  const found=GROUP_TOKEN.exec(value);
  if(!found)return [];
  result.push(found[1]??found[2]??found[3]);
  offset=GROUP_TOKEN.lastIndex;
  if(offset===value.length)break;
  const separator=/^(?:\s*,\s*|\s+)/.exec(value.slice(offset));
  if(!separator)return [];
  offset+=separator[0].length;
  if(offset===value.length)return [];
 }
 return result;
};
const groups=(claims)=>{
 const raw=claims?.['cognito:groups'];
 if(Array.isArray(raw))return raw.every(value=>typeof value==='string'&&GROUP_NAME.test(value))?raw:[];
 if(typeof raw!=='string'||raw.length>1024)return [];
 const value=raw.trim();
 if(value.startsWith('[')||value.endsWith(']')){
  if(!value.startsWith('[')||!value.endsWith(']'))return [];
  try{
   const parsed=JSON.parse(value);
   if(Array.isArray(parsed))
    return parsed.every(member=>typeof member==='string'&&GROUP_NAME.test(member))?parsed:[];
  }catch{}
  return parseGroupSequence(value.slice(1,-1));
 }
 return parseGroupSequence(value);
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
export function stagingAuthDiagnostic(event,{issuer=process.env.MANAGEMENT_COGNITO_ISSUER,clientId=process.env.MANAGEMENT_COGNITO_CLIENT_ID}={}){
 // Only boolean and structural diagnostics. Never log token, subject, username,
 // email, full claims, or the original group names.
 const jwt=event?.requestContext?.authorizer?.jwt;
 const claims=jwt?.claims;
 const raw=claims?.['cognito:groups'];
 const parsed=groups(claims);
 return {
  version:'lb05-auth-v2',
  gatewayJwtPresent:Boolean(jwt),
  claimsPresent:Boolean(claims),
  subjectPresent:typeof claims?.sub==='string'&&claims.sub.length>0,
  issuerMatches:claims?.iss===issuer,
  clientMatches:claims?.client_id===clientId,
  tokenUseAccess:claims?.token_use==='access',
  groupEncoding:Array.isArray(raw)?'array':typeof raw==='string'?
   raw.trim().startsWith('[')?'bracketed':'string':'missing',
  parsedGroupCount:parsed.length,
  viewerRolePresent:parsed.includes('lesbuttes-viewer'),
  ownerRolePresent:parsed.includes('lesbuttes-owner'),
  adminRolePresent:parsed.includes('lesbuttes-admin')
 };
}
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function createAdminHandler({reader,writeAction,writeConfig,writeEnabled=()=>false,
 approvalEnabled=()=>false,checkoutEnabled=()=>false,registerCheckout,readCheckout,reconciliationEnabled=()=>false,reconcilePayment}){
 return async event=>{
   try{
     const method=event?.requestContext?.http?.method;
     if(method!=='GET'&&method!=='POST')return reply(405,{error:'Method not allowed'});
     const id=identityFromGateway(event);
     if(!id){
       // Safe rejection telemetry: never log the identity or JWT payload.
       if(process.env.BOOKING_ENVIRONMENT==='staging')
         console.warn('LB05_AUTH_REJECT',JSON.stringify(stagingAuthDiagnostic(event)));
       return reply(403,{error:'Forbidden'});
     }
     const path=event.rawPath??'';
     if(method==='POST'){
       const match=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/actions\/(approve|decline|cancel)$/i);
       const configMatch=path.match(/^\/admin\/config\/(pricing|stay-rules|cancellation|payments|business|arrival-departure|terms)\/(geranium|honeysuckle|all)\/(publish|rollback)$/);
       if(configMatch){
         if(id.role!=='owner')return reply(403,{error:'Forbidden'});
         if(process.env.BOOKING_ENVIRONMENT!=='staging'||!process.env.BOOKINGS_TABLE?.toLowerCase().includes('staging')||
           !writeEnabled()||typeof writeConfig!=='function')return reply(503,{error:'Management writes disabled'});
         if(event.isBase64Encoded||typeof event.body!=='string'||event.body.length>22000)return reply(400,{error:'Invalid request'});
         let payload;
         try{payload=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid request'});}
         if(!payload||typeof payload!=='object'||Array.isArray(payload))return reply(400,{error:'Invalid request'});
         const keys=configMatch[3]==='publish'?['value','expectedVersion','approved']:['historicalVersion','expectedVersion','approved'];
         if(Object.keys(payload).some(k=>!keys.includes(k))||payload.approved!==true||
           !Object.hasOwn(payload,'expectedVersion'))return reply(400,{error:'Explicit approval and expected version required'});
         try{
           return reply(200,await writeConfig({identity:id,kind:configMatch[1],unit:configMatch[2],
             operation:configMatch[3],...payload}));
         }catch(e){
           if(e?.name==='TransactionCanceledException')return reply(409,{error:'Configuration changed; refresh and retry'});
           if(/Invalid|Unknown|required|too large|restriction|range|band|tier|season|approval|not found/.test(e?.message??''))
             return reply(400,{error:'Invalid configuration'});
           throw e;
         }
       }
       const paymentMatch=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/payment\/reconcile$/i);
       if(paymentMatch){
         if(id.role!=='owner')return reply(403,{error:'Forbidden'});
         if(process.env.BOOKING_ENVIRONMENT!=='staging'||!writeEnabled()||
            !reconciliationEnabled()||typeof reconcilePayment!=='function')
           return reply(503,{error:'Payment reconciliation disabled'});
         if(event.isBase64Encoded||event.body!=='{}')
           return reply(400,{error:'Payment reconciliation accepts no payment assertions'});
         try{return reply(200,await reconcilePayment({bookingId:paymentMatch[1],identity:id}));}
         catch(e){
           if(/not verified|missing|mismatch|not eligible|disabled|reconciliation|TransactionCanceled/.test(e?.message??''))
             return reply(409,{error:'Payment not confirmed; reconcile with provider before retrying'});
           throw e;
         }
       }
       const checkoutMatch=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/checkout\/register$/i);
       if(checkoutMatch){
         if(id.role!=='owner')return reply(403,{error:'Forbidden'});
         if(process.env.BOOKING_ENVIRONMENT!=='staging'||
            !process.env.BOOKINGS_TABLE?.toLowerCase().includes('staging')||
            !writeEnabled()||!checkoutEnabled()||typeof registerCheckout!=='function')
           return reply(503,{error:'Checkout registration disabled'});
         if(event.isBase64Encoded||event.body!=='{}')
           return reply(400,{error:'Checkout registration does not accept payment details'});
         try{return reply(200,await registerCheckout({bookingId:checkoutMatch[1],identity:id}));}
         catch(e){
           if(e?.name==='TransactionCanceledException'||/not eligible|unavailable|Conflicting|reconciliation|not verified|already claimed/.test(e?.message??''))
             return reply(409,{error:'Checkout registration requires owner reconciliation'});
           throw e;
         }
       }
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
       if(match[2]==='approve'&&!approvalEnabled())
         return reply(503,{error:'Booking approval disabled'});
       if(match[2]==='approve'){
         const allowed=['approved','amountPence','priceChangeReason','usePublishedQuote'];
         const published=payload.usePublishedQuote===true;
         if(Object.keys(payload).some(k=>!allowed.includes(k))||
            payload.approved!==true||
            (published?(Object.hasOwn(payload,'amountPence')||
               Object.hasOwn(payload,'priceChangeReason')):
              (!Number.isSafeInteger(payload.amountPence)||
               payload.amountPence<1||payload.amountPence>100000000||
               (payload.priceChangeReason!==undefined&&
                (typeof payload.priceChangeReason!=='string'||payload.priceChangeReason.length>1000)))))
           return reply(400,{error:'Explicit approval and valid published quote or GBP amount in pence required'});
       }else if(Object.keys(payload).some(k=>k!=='reason')||
          typeof payload.reason!=='string'||payload.reason.trim().length<5||payload.reason.length>1000)
         return reply(400,{error:'A recorded reason is required'});
       try{
         const result=await writeAction({identity:id,bookingId:match[1],action:match[2],
           ...(match[2]==='approve'?{approval:{...(payload.usePublishedQuote===true?{usePublishedQuote:true}:{amountPence:payload.amountPence}),
             ...(payload.priceChangeReason!==undefined?
              {priceChangeReason:payload.priceChangeReason}:{})}}:{reason:payload.reason})});
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

     // Owner-only checkout registration status. The provider's payment state is
     // deliberately not inferred from this record, and the hosted URL is omitted.
     const checkoutStatus=path.match(/^\/admin\/bookings\/([0-9a-f-]{36})\/checkout\/status$/i);
     if(checkoutStatus){
       if(id.role!=='owner')return reply(403,{error:'Forbidden'});
       if(process.env.BOOKING_ENVIRONMENT!=='staging'||typeof readCheckout!=='function')
         return reply(503,{error:'Checkout status unavailable'});
       const record=await reader.getBooking(event,checkoutStatus[1]);
       if(!record)return reply(404,{error:'Not found'});
       const checkout=await readCheckout({bookingId:checkoutStatus[1]});
       // Checkout registration is not proof of payment. The authoritative
       // booking state is updated only by provider-verified reconciliation.
       const confirmed=record.status==='CONFIRMED'&&record.reservationStatus==='CONFIRMED';
       return reply(200,{bookingId:checkoutStatus[1],
         registered:Boolean(checkout),bookingConfirmed:confirmed,
         ...(confirmed?{confirmationRecordedAt:record.paidAt??null}:{}),
         ...(checkout?{checkoutId:checkout.checkoutId,
           registrationStatus:checkout.status,
           amountPence:checkout.amountPence,currency:checkout.currency}:{})});
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
       const cursorRaw=event.queryStringParameters?.cursor;
       let cursor=null;
       if(cursorRaw){
         try{cursor=JSON.parse(Buffer.from(cursorRaw,'base64url').toString('utf8'));}
         catch{return reply(400,{error:'Invalid cursor'});}
       }
       const data=await reader.listBookings(event,{limit,cursor});
       return reply(200,{items:data.items,
         nextCursor:data.nextCursor?Buffer.from(JSON.stringify(data.nextCursor)).toString('base64url'):null});
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
     approvalEnabled:()=>staging&&process.env.MANAGEMENT_APPROVAL_ENABLED==='true',
     checkoutEnabled:()=>staging&&checkoutRuntimeEnabled(process.env),
     reconciliationEnabled:()=>staging&&paymentReconciliationEnabled(process.env),
     reconcilePayment:staging?async args=>reconcileOwnerSandboxPayment({db,...args}):undefined,
     registerCheckout:staging?async args=>registerCheckoutWithSandbox({db,...args}):undefined,
     readCheckout:staging?async ({bookingId})=>readRegisteredCheckout({db,table,bookingId}):undefined,
     writeConfig:staging?async ({operation,...args})=>operation==='rollback'?rollbackOwnerConfiguration({db,table,...args}):publishOwnerConfiguration({db,table,...args}):undefined,
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
