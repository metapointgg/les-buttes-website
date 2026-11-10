import test from 'node:test';import assert from 'node:assert/strict';
import {createAdminHandler} from './booking-admin-http.mjs';
const id='11111111-1111-4111-8111-111111111111';
const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_testing';
const clientId='public-staging-client';
const event=(body='{}',group='lesbuttes-owner')=>({
 rawPath:'/admin/bookings/'+id+'/checkout/register',body,
 requestContext:{http:{method:'POST'},authorizer:{jwt:{claims:{
  sub:'owner-1',iss:issuer,client_id:clientId,token_use:'access',
  'cognito:groups':[group]}}}}
});
function setup(t){
 const keys=['BOOKING_ENVIRONMENT','BOOKINGS_TABLE','MANAGEMENT_COGNITO_ISSUER','MANAGEMENT_COGNITO_CLIENT_ID'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{BOOKING_ENVIRONMENT:'staging',
  BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',
  MANAGEMENT_COGNITO_ISSUER:issuer,MANAGEMENT_COGNITO_CLIENT_ID:clientId});
 t.after(()=>{for(const k of keys){if(old[k]===undefined)delete process.env[k];
  else process.env[k]=old[k];}});
}
test('LB-08 checkout endpoint disabled by default even when management writes enabled',async t=>{
 setup(t);let calls=0;
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,
  registerCheckout:async()=>{calls++;}});
 assert.equal((await handler(event())).statusCode,503);assert.equal(calls,0);
});
test('LB-08 owner-only, separately enabled checkout endpoint sends no amount or URL from request',async t=>{
 setup(t);const calls=[];
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,
  checkoutEnabled:()=>true,registerCheckout:async input=>{
   calls.push(input);return {status:'REGISTERED',bookingId:id,
    amountPence:100,currency:'GBP',guestNotificationSent:false};}});
 assert.equal((await handler(event())).statusCode,200);
 assert.deepEqual(calls,[{bookingId:id,identity:{subject:'owner-1',role:'owner'}}]);
 assert.equal((await handler(event('{}','lesbuttes-viewer'))).statusCode,403);
 assert.equal((await handler(event('{"amountPence":1}'))).statusCode,400);
 assert.equal((await handler(event('{"paymentUrl":"https://example.com"}'))).statusCode,400);
 assert.equal(calls.length,1);
 process.env.BOOKING_ENVIRONMENT='production';
 assert.equal((await handler(event())).statusCode,503);
});
test('LB-08 checkout conflicts return 409 and no payment link',async t=>{
 setup(t);
 const handler=createAdminHandler({reader:{},writeEnabled:()=>true,
  checkoutEnabled:()=>true,registerCheckout:async()=>{throw Error('Booking not eligible for checkout registration');}});
 const result=await handler(event());
 assert.equal(result.statusCode,409);
 assert.ok(!result.body.includes('checkout.sumup.com'));
});
