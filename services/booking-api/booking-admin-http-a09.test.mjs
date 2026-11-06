import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from './booking-admin-http.mjs';

const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_A09Test';
const client='a09-test-client';
const bookingId='11111111-2222-4333-8444-555555555555';
function event({role='lesbuttes-owner',method='POST',action='approve',payload={approved:true,usePublishedQuote:true}}={}){
 return {rawPath:'/admin/bookings/'+bookingId+'/actions/'+action,
  requestContext:{http:{method},authorizer:{jwt:{claims:{
   sub:'a09-owner-subject',iss:issuer,client_id:client,token_use:'access',
   'cognito:groups':[role]}}}},
  body:JSON.stringify(payload),isBase64Encoded:false};
}
function fixture({writes=true,approvals=true}={}){
 const calls=[];
 const handler=createAdminHandler({
  reader:{},writeEnabled:()=>writes,approvalEnabled:()=>approvals,
  writeAction:async args=>{calls.push(args);return {id:args.bookingId,to:'APPROVED_AWAITING_PAYMENT'};}
 });
 return {handler,calls};
}
const previous={issuer:process.env.MANAGEMENT_COGNITO_ISSUER,client:process.env.MANAGEMENT_COGNITO_CLIENT_ID,
 environment:process.env.BOOKING_ENVIRONMENT,table:process.env.BOOKINGS_TABLE};
test.before(()=>{
 process.env.MANAGEMENT_COGNITO_ISSUER=issuer;
 process.env.MANAGEMENT_COGNITO_CLIENT_ID=client;
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='les-buttes-lb08-staging-isolated-acceptance';
});
test.after(()=>{
 for(const [name,value] of Object.entries({
  MANAGEMENT_COGNITO_ISSUER:previous.issuer,MANAGEMENT_COGNITO_CLIENT_ID:previous.client,
  BOOKING_ENVIRONMENT:previous.environment,BOOKINGS_TABLE:previous.table
 }))if(value===undefined)delete process.env[name];else process.env[name]=value;
});
test('A09 owner approve route passes explicit published-quote consent to existing writer',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(event());
 assert.equal(response.statusCode,200);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{identity:{role:'owner',subject:'a09-owner-subject'},
  bookingId,action:'approve',approval:{usePublishedQuote:true}});
});
test('A09 decline route passes recorded reason without payment assertion',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(event({action:'decline',payload:{reason:'Guest request withdrawn'}}));
 assert.equal(response.statusCode,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].reason,'Guest request withdrawn');
 assert.equal(calls[0].action,'decline');
});
test('A09 viewer cannot invoke owner write route',async()=>{
 const {handler,calls}=fixture();
 assert.equal((await handler(event({role:'lesbuttes-viewer'}))).statusCode,403);
 assert.equal(calls.length,0);
});
test('A09 write flag fails closed',async()=>{
 const {handler,calls}=fixture({writes:false});
 assert.equal((await handler(event())).statusCode,503);
 assert.equal(calls.length,0);
});
test('A09 approval flag fails closed',async()=>{
 const {handler,calls}=fixture({approvals:false});
 assert.equal((await handler(event())).statusCode,503);
 assert.equal(calls.length,0);
});
test('A09 rejects injected payment URL before writer call',async()=>{
 const {handler,calls}=fixture();
 assert.equal((await handler(event({payload:{approved:true,usePublishedQuote:true,paymentUrl:'https://example.invalid'}}))).statusCode,400);
 assert.equal(calls.length,0);
});
test('A09 rejects unverified gateway identity',async()=>{
 const {handler,calls}=fixture();
 const request=event();
 request.requestContext.authorizer.jwt.claims.token_use='id';
 assert.equal((await handler(request)).statusCode,403);
 assert.equal(calls.length,0);
});
