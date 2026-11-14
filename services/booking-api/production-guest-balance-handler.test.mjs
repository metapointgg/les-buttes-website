import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionGuestBalanceHandler} from './production-guest-balance-handler.mjs';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const id='11111111-1111-4111-8111-111111111111',token='A'.repeat(43);
const env={BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:table,AWS_REGION:'eu-west-2',
 PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true',LIVE_BOOKINGS_APPROVED:'true',
 BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'false'};
const booking={id,source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paymentStatus:'PARTIALLY_PAID',balanceDuePence:40250,balanceAccessToken:token};
const event=(body={bookingId:id,access:token},origin='https://lesbuttes.com')=>({
 rawPath:'/balance/checkout',headers:{origin},requestContext:{http:{method:'POST'}},
 body:JSON.stringify(body)});
test('guest can request a fresh session only for matching confirmed outstanding booking',async()=>{
 let call=0;
 const handler=createProductionGuestBalanceHandler({env,db:{send:async()=>({Item:booking})},
  ssmFactory:()=>({destroy(){}}),clientFactory:async()=>({}),
  register:async args=>{call++;assert.equal(args.bookingId,id);
   assert.equal(args.identity.role,'system');
   return {status:'REGISTERED',checkout:{bookingId:id,amountPence:40250,
    status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/pay/c-11111111-2222-4333-8444-555555555555'}};}});
 const result=await handler(event());
 assert.equal(result.statusCode,200);
 assert.equal(JSON.parse(result.body).sessionMinutes,30);
 assert.equal(call,1);
});
test('guest token, arbitrary origin, amount injection and expired booking are rejected before SumUp',async()=>{
 let count=0;
 const handler=createProductionGuestBalanceHandler({env,db:{send:async()=>({Item:booking})},
  clientFactory:async()=>{count++;return {};}});
 for(const e of [
  event({bookingId:id,access:'B'.repeat(43)}),
  event(undefined,'https://attacker.invalid'),
  event({bookingId:id,access:token,amount:1}),
  {...event(),requestContext:{http:{method:'GET'}}},
  {...event(),isBase64Encoded:true}
 ]){
  assert.notEqual((await handler(e)).statusCode,200);
 }
 assert.equal(count,0);
 const disabled=createProductionGuestBalanceHandler({env:{...env,BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'true'}});
 assert.equal((await disabled(event())).statusCode,503);
});
