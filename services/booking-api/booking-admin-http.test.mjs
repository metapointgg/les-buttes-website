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
