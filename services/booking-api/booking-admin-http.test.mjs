import test from 'node:test';
import assert from 'node:assert/strict';
import {identityFromGateway,createAdminHandler} from './booking-admin-http.mjs';
const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_testing';
const clientId='public-staging-client';
const verified={requestContext:{http:{method:'GET'},authorizer:{jwt:{claims:{
  sub:'owner-user-id',iss:issuer,client_id:clientId,token_use:'access','cognito:groups':['lesbuttes-owner']
}}}}};
test('only verified access tokens from expected Cognito pool/client are accepted',()=>{
 const opts={issuer,clientId};
 assert.deepEqual(identityFromGateway(verified,opts),{subject:'owner-user-id',role:'owner'});
 assert.equal(identityFromGateway({...verified,requestContext:{...verified.requestContext,authorizer:{jwt:{claims:{...verified.requestContext.authorizer.jwt.claims,token_use:'id'}}}}},opts),null);
 assert.equal(identityFromGateway(verified,{issuer,clientId:'other'}),null);
 assert.equal(identityFromGateway(verified,{issuer:'other',clientId}),null);
 assert.equal(identityFromGateway({requestContext:{http:{method:'GET'}}},opts),null);
 assert.equal(identityFromGateway({...verified,requestContext:{...verified.requestContext,authorizer:{jwt:{claims:{...verified.requestContext.authorizer.jwt.claims,'cognito:groups':[]}}}}},opts),null);
});
test('admin route is read-only, requires JWT and never approves on GET',async()=>{
 const origIssuer=process.env.MANAGEMENT_COGNITO_ISSUER,origClient=process.env.MANAGEMENT_COGNITO_CLIENT_ID;
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 try {
  const calls=[];
  const handler=createAdminHandler({reader:{
    getConfig:async(_,kind,unit)=>{calls.push([kind,unit]);return {kind,unit,version:'v1'};},
    getConfigHistory:async()=>[],
    getBooking:async()=>null,
    listBookings:async()=>({items:[],nextCursor:null})
  }});
  assert.equal((await handler({...verified,rawPath:'/admin/config/payments/all'})).statusCode,200);
  assert.equal((await handler({...verified,requestContext:{http:{method:'POST'},authorizer:verified.requestContext.authorizer},rawPath:'/admin/bookings/approve'})).statusCode,405);
  assert.equal((await handler({requestContext:{http:{method:'GET'}},rawPath:'/admin/config/payments/all'})).statusCode,403);
  assert.deepEqual(calls,[['payments','all']]);
 }finally{
  if(origIssuer===undefined)delete process.env.MANAGEMENT_COGNITO_ISSUER;else process.env.MANAGEMENT_COGNITO_ISSUER=origIssuer;
  if(origClient===undefined)delete process.env.MANAGEMENT_COGNITO_CLIENT_ID;else process.env.MANAGEMENT_COGNITO_CLIENT_ID=origClient;
 }
});

test('owner preflight is read-only and rejects viewer, missing reason and confirmation',async()=>{
 const oldIssuer=process.env.MANAGEMENT_COGNITO_ISSUER,oldClient=process.env.MANAGEMENT_COGNITO_CLIENT_ID;
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 const bookingId='11111111-1111-4111-8111-111111111111';
 const calls=[];
 const handler=createAdminHandler({reader:{
   getBooking:async()=>{calls.push('read');return {status:'REQUESTED',holdExpiresAt:Math.floor(Date.now()/1000)+3600};}
 }});
 try{
   const url='/admin/bookings/'+bookingId+'/actions/approve/preflight';
   const owner=await handler({...verified,rawPath:url});
   assert.equal(owner.statusCode,200);
   assert.equal(JSON.parse(owner.body).allowed,true);
   const viewer={...verified,requestContext:{...verified.requestContext,authorizer:{jwt:{claims:{...verified.requestContext.authorizer.jwt.claims,'cognito:groups':['lesbuttes-viewer']}}}}};
   assert.equal((await handler({...viewer,rawPath:url})).statusCode,403);
   assert.equal((await handler({...verified,rawPath:url.replace('approve','confirm')})).statusCode,404);
   assert.equal((await handler({...verified,requestContext:{...verified.requestContext,http:{method:'POST'}},rawPath:url})).statusCode,405);
   assert.equal(calls.length,2);
 }finally{
   if(oldIssuer===undefined)delete process.env.MANAGEMENT_COGNITO_ISSUER;else process.env.MANAGEMENT_COGNITO_ISSUER=oldIssuer;
   if(oldClient===undefined)delete process.env.MANAGEMENT_COGNITO_CLIENT_ID;else process.env.MANAGEMENT_COGNITO_CLIENT_ID=oldClient;
 }
});

test('preflight cancellation requires owner reason and never mutates booking',async()=>{
 const previousIssuer=process.env.MANAGEMENT_COGNITO_ISSUER;
 const previousClient=process.env.MANAGEMENT_COGNITO_CLIENT_ID;
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 const bookingId='11111111-1111-4111-8111-111111111111';
 let reads=0;
 const handler=createAdminHandler({reader:{getBooking:async()=>{reads++;return {status:'CONFIRMED'};}}});
 const url='/admin/bookings/'+bookingId+'/actions/cancel/preflight';
 try{
   const missing=await handler({...verified,rawPath:url});
   assert.equal(missing.statusCode,403);
   assert.equal(JSON.parse(missing.body).allowed,false);
   const allowed=await handler({...verified,rawPath:url,queryStringParameters:{reason:'Guest requested cancellation'}});
   assert.equal(allowed.statusCode,200);
   assert.deepEqual(JSON.parse(allowed.body),{allowed:true,from:'CONFIRMED',to:'CANCELLED'});
   assert.equal(reads,2);
 }finally{
   if(previousIssuer===undefined)delete process.env.MANAGEMENT_COGNITO_ISSUER;else process.env.MANAGEMENT_COGNITO_ISSUER=previousIssuer;
   if(previousClient===undefined)delete process.env.MANAGEMENT_COGNITO_CLIENT_ID;else process.env.MANAGEMENT_COGNITO_CLIENT_ID=previousClient;
 }
});

test('LB-03 audit endpoint is GET-only, authenticated and paginates safely',async()=>{
 const previousIssuer=process.env.MANAGEMENT_COGNITO_ISSUER;
 const previousClient=process.env.MANAGEMENT_COGNITO_CLIENT_ID;
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 const id='11111111-1111-4111-8111-111111111111';
 const cursor={PK:'BOOKING#'+id,SK:'AUDIT#2026-10-31T12:00:00.000Z#x'};
 const handler=createAdminHandler({reader:{getBookingAudit:async(_,ref,args)=>{
   assert.equal(ref,id);
   assert.equal(args.limit,5);
   return {items:[{action:'decline'}],nextCursor:cursor};
 }}});
 const url='/admin/bookings/'+id+'/audit';
 try{
   const result=await handler({...verified,rawPath:url,queryStringParameters:{limit:'5'}});
   assert.equal(result.statusCode,200);
   assert.equal(JSON.parse(result.body).items[0].action,'decline');
   assert.ok(JSON.parse(result.body).nextCursor);
   assert.equal((await handler({...verified,rawPath:url,queryStringParameters:{limit:'5',cursor:'not-json'}})).statusCode,400);
   assert.equal((await handler({...verified,rawPath:url,requestContext:{...verified.requestContext,http:{method:'POST'}}})).statusCode,405);
   assert.equal((await handler({requestContext:{http:{method:'GET'}},rawPath:url})).statusCode,403);
 }finally{
   if(previousIssuer===undefined)delete process.env.MANAGEMENT_COGNITO_ISSUER;else process.env.MANAGEMENT_COGNITO_ISSUER=previousIssuer;
   if(previousClient===undefined)delete process.env.MANAGEMENT_COGNITO_CLIENT_ID;else process.env.MANAGEMENT_COGNITO_CLIENT_ID=previousClient;
 }
});

test('LB-04 write route is disabled by default and only owner may use staging flag',async()=>{
 const previous={issuer:process.env.MANAGEMENT_COGNITO_ISSUER,client:process.env.MANAGEMENT_COGNITO_CLIENT_ID,
   env:process.env.BOOKING_ENVIRONMENT,table:process.env.BOOKINGS_TABLE};
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='les-buttes-booking-staging';
 const id='11111111-1111-4111-8111-111111111111';
 const url='/admin/bookings/'+id+'/actions/decline';
 let writes=0;
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,writeAction:async args=>{
   writes++;assert.equal(args.identity.role,'owner');assert.equal(args.action,'decline');
   return {id,from:'REQUESTED',to:'DECLINED'};
 }});
 const event={...verified,rawPath:url,body:JSON.stringify({reason:'Owner rejected booking'}),
   requestContext:{...verified.requestContext,http:{method:'POST'}}};
 try{
   const disabled=createAdminHandler({reader:{},writeAction:async()=>{writes++;}});
   assert.equal((await disabled(event)).statusCode,503);
   const viewer={...event,requestContext:{...event.requestContext,authorizer:{jwt:{claims:{
     ...verified.requestContext.authorizer.jwt.claims,'cognito:groups':['lesbuttes-viewer']
   }}}}};
   assert.equal((await handler(viewer)).statusCode,403);
   assert.equal((await handler({...event,rawPath:url.replace('decline','approve')})).statusCode,503);
   assert.equal((await handler({...event,body:'{}'})).statusCode,400);
   assert.equal((await handler({...event,body:JSON.stringify({reason:'Owner rejected booking',extra:1})})).statusCode,400);
   assert.equal((await handler(event)).statusCode,200);
   assert.equal(writes,1);
   process.env.BOOKING_ENVIRONMENT='production';
   assert.equal((await handler(event)).statusCode,503);
   assert.equal(writes,1);
 }finally{
   for(const [key,name] of [['issuer','MANAGEMENT_COGNITO_ISSUER'],['client','MANAGEMENT_COGNITO_CLIENT_ID'],
     ['env','BOOKING_ENVIRONMENT'],['table','BOOKINGS_TABLE']]){
     if(previous[key]===undefined)delete process.env[name];else process.env[name]=previous[key];
   }
 }
});

test('LB-04 conflicting and replayed owner actions fail closed',async()=>{
 const previous={issuer:process.env.MANAGEMENT_COGNITO_ISSUER,client:process.env.MANAGEMENT_COGNITO_CLIENT_ID,
   env:process.env.BOOKING_ENVIRONMENT,table:process.env.BOOKINGS_TABLE};
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='les-buttes-booking-staging';
 let attempts=0;
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,writeAction:async()=>{
   attempts++;
   if(attempts===1)return {to:'DECLINED'};
   throw Object.assign(new Error('stale state'),{name:'TransactionCanceledException'});
 }});
 const event={...verified,rawPath:'/admin/bookings/11111111-1111-4111-8111-111111111111/actions/decline',
   body:JSON.stringify({reason:'Owner declined request'}),
   requestContext:{...verified.requestContext,http:{method:'POST'}}};
 try{
   assert.equal((await handler(event)).statusCode,200);
   assert.equal((await handler(event)).statusCode,409);
   assert.equal(attempts,2);
 }finally{
   for(const [key,name] of [['issuer','MANAGEMENT_COGNITO_ISSUER'],['client','MANAGEMENT_COGNITO_CLIENT_ID'],
     ['env','BOOKING_ENVIRONMENT'],['table','BOOKINGS_TABLE']]){
     if(previous[key]===undefined)delete process.env[name];else process.env[name]=previous[key];
   }
 }
});
