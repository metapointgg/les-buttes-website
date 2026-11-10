import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from './booking-admin-http.mjs';
const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_testing';
const clientId='public-staging-client',bookingId='11111111-1111-4111-8111-111111111111';
const claims={sub:'owner-1',iss:issuer,client_id:clientId,token_use:'access',
 'cognito:groups':['lesbuttes-owner']};
const event=(body,groups=['lesbuttes-owner'])=>({
 rawPath:'/admin/bookings/'+bookingId+'/actions/approve',
 body:JSON.stringify(body),requestContext:{http:{method:'POST'},
 authorizer:{jwt:{claims:{...claims,'cognito:groups':groups}}}}
});
async function fixture(t){
 const before={issuer:process.env.MANAGEMENT_COGNITO_ISSUER,
  client:process.env.MANAGEMENT_COGNITO_CLIENT_ID,
  environment:process.env.BOOKING_ENVIRONMENT,table:process.env.BOOKINGS_TABLE};
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=clientId;
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='les-buttes-booking-staging';
 t.after(()=>{
  for(const [key,name] of [['issuer','MANAGEMENT_COGNITO_ISSUER'],
   ['client','MANAGEMENT_COGNITO_CLIENT_ID'],
   ['environment','BOOKING_ENVIRONMENT'],['table','BOOKINGS_TABLE']]){
   if(before[key]===undefined)delete process.env[name];else process.env[name]=before[key];
  }
 });
}
test('LB-08 approval is independently disabled even when management writes are enabled',async t=>{
 await fixture(t);let writes=0;
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,
  writeAction:async()=>{writes++;}});
 const response=await handler(event({approved:true,amountPence:25000}));
 assert.equal(response.statusCode,503);assert.equal(writes,0);
});
test('LB-08 enabled owner approval passes only reviewed pence and no payment URL',async t=>{
 await fixture(t);const calls=[];
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,approvalEnabled:()=>true,
  writeAction:async input=>{calls.push(input);return {to:'APPROVED_AWAITING_PAYMENT',
   affectedNights:7};}});
 const response=await handler(event({approved:true,amountPence:25000,
  priceChangeReason:'Agreed returning guest price'}));
 assert.equal(response.statusCode,200);
 assert.deepEqual(calls,[{identity:{role:'owner',subject:'owner-1'},bookingId,
  action:'approve',approval:{amountPence:25000,priceChangeReason:'Agreed returning guest price'}}]);
 assert.ok(!JSON.stringify(response).includes('paymentUrl'));
});
test('LB-08 owner approval rejects guest URLs, wrong roles, implicit consent and production',async t=>{
 await fixture(t);let writes=0;
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,approvalEnabled:()=>true,
  writeAction:async()=>{writes++;}});
 for(const payload of [
  {amountPence:25000},{approved:true,amountPence:0},
  {approved:true,amountPence:12.5},
  {approved:true,amountPence:25000,paymentUrl:'https://checkout.sumup.com/pay/test'},
  {approved:true,amountPence:25000,reason:'manual override'}
 ])assert.equal((await handler(event(payload))).statusCode,400);
 assert.equal((await handler(event({approved:true,amountPence:25000},['lesbuttes-viewer']))).statusCode,403);
 process.env.BOOKING_ENVIRONMENT='production';
 assert.equal((await handler(event({approved:true,amountPence:25000}))).statusCode,503);
 assert.equal(writes,0);
});
test('LB-08 stale transactional approval produces conflict without confirmation',async t=>{
 await fixture(t);
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,approvalEnabled:()=>true,
  writeAction:async()=>{throw Object.assign(new Error('conditional failure'),
    {name:'TransactionCanceledException'});}});
 assert.equal((await handler(event({approved:true,amountPence:25000}))).statusCode,409);
});
