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
