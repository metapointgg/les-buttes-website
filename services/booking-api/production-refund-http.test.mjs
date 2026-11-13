import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from './booking-admin-http.mjs';

const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_A09Test';
const clientId='refund-owner-app-test';
const id='884cd893-36cc-4a75-81f4-f1d5b18f8a9b';
const previous={issuer:process.env.MANAGEMENT_COGNITO_ISSUER,
 client:process.env.MANAGEMENT_COGNITO_CLIENT_ID};
test.before(()=>{
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
});
test.after(()=>{
 for(const [key,val] of [['MANAGEMENT_COGNITO_ISSUER',previous.issuer],
  ['MANAGEMENT_COGNITO_CLIENT_ID',previous.client]])
  if(val===undefined)delete process.env[key];else process.env[key]=val;
});
const request=(role='lesbuttes-owner',body='{}')=>({
 rawPath:'/admin/bookings/'+id+'/refund/reconcile',body,isBase64Encoded:false,
 requestContext:{http:{method:'POST'},authorizer:{jwt:{claims:{
  sub:'owner-test-sub',iss:issuer,client_id:clientId,token_use:'access',
  'cognito:groups':[role]}}}}
});
test('owner-only read-provider refund reconciliation accepts no user-entered payment evidence',async()=>{
 const calls=[];
 const handler=createAdminHandler({reader:{},
  writeDeploymentAllowed:()=>true,writeEnabled:()=>true,
  refundReconciliationEnabled:()=>true,reconcileRefund:async input=>{
   calls.push(input);return {status:'REFUNDED',bookingId:id,amountPence:100};}});
 const ok=await handler(request());
 assert.equal(ok.statusCode,200);
 assert.deepEqual(calls,[{bookingId:id,identity:{role:'owner',subject:'owner-test-sub'}}]);
 for(const body of ['{"refundAmountPence":100}','{"providerStatus":"REFUNDED"}','',null]){
  const response=await handler(request('lesbuttes-owner',body));
  assert.equal(response.statusCode,400);
 }
 assert.equal(calls.length,1);
 assert.equal((await handler(request('lesbuttes-viewer'))).statusCode,403);
 assert.equal(calls.length,1);
});
test('refund reconciliation remains default-off and fails closed without release gates',async()=>{
 let calls=0;
 const handler=createAdminHandler({reader:{},writeDeploymentAllowed:()=>true,
  writeEnabled:()=>true,reconcileRefund:async()=>{calls++;return {status:'REFUNDED'};}});
 assert.equal((await handler(request())).statusCode,503);
 assert.equal(calls,0);
});
test('provider mismatch returns conflict without claiming refund completion',async()=>{
 const handler=createAdminHandler({reader:{},writeDeploymentAllowed:()=>true,
  writeEnabled:()=>true,refundReconciliationEnabled:()=>true,
  reconcileRefund:async()=>{throw Error('SumUp refund not verified');}});
 assert.equal((await handler(request())).statusCode,409);
});
