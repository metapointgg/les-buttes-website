import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingGuestRequest} from './staging-guest-request.mjs';
import {createGuestHandler,validChallengeResponse} from './staging-guest-handler.mjs';
const payload={unit:'geranium',start:'2027-04-03',end:'2027-04-10',adults:2,children:0,
 firstName:'Test',lastName:'Guest',email:'test@example.invalid',telephone:'01481263794',consent:true,
 turnstileToken:'XXXX.DUMMY.TOKEN.XXXX'};
const quote={status:'PUBLISHED_CONFIG_VERIFIED',currency:'GBP',totalGBP:'805.00',
 units:[{unit:'geranium',version:3,priceGBP:'805.00'}],nights:7,minimumNights:3};
const now=Date.parse('2026-11-08T23:00:00Z');
test('new request preserves the server quote and atomically reserves every night',async()=>{
 let transaction;
 const result=await createStagingGuestRequest({payload,now,verifyTurnstile:async()=>true,
  loadQuote:async selection=>{assert.equal(selection.nights.length,7);return quote;},
  writeHold:async hold=>{transaction=hold;}});
 assert.equal(result.totalGBP,'805.00');
 assert.deepEqual(result.pricingVersions,[{unit:'geranium',version:3}]);
 assert.equal(transaction.items.length,8);
 assert.deepEqual(transaction.meta.quote,quote);
 assert.equal(transaction.meta.synthetic,true);
 assert.equal(transaction.meta.guestEmail,'test@example.invalid');
 assert.equal(transaction.meta.reservationStatus,'PENDING_REVIEW');
 assert.ok(transaction.items.slice(1).every(x=>x.Put.ConditionExpression.includes('expiresAt < :now')));
 assert.equal(transaction.items.at(-1).Put.Item.SK,'DATE#2027-04-09');
});
test('client prices, real identities and malformed dates cannot create holds',async()=>{
 for(const change of [{totalGBP:'1.00'},{email:'guest@example.com'},{consent:false},{start:'2027-02-30'},
  {unit:'both',adults:2},{adults:5}]){
  await assert.rejects(createStagingGuestRequest({payload:{...payload,...change},now,
   verifyTurnstile:async()=>true,loadQuote:async()=>quote,writeHold:async()=>assert.fail('unexpected write')}));
 }
});
test('challenge failure and unpublished pricing cannot create holds',async()=>{
 for(const [verified,published] of [[false,quote],[true,{error:'missing'}]]){
  await assert.rejects(createStagingGuestRequest({payload,now,verifyTurnstile:async()=>verified,
   loadQuote:async()=>published,writeHold:async()=>assert.fail('unexpected write')}));
 }
});
test('conflicting transaction does not report a received booking',async()=>{
 await assert.rejects(createStagingGuestRequest({payload,now,verifyTurnstile:async()=>true,
  loadQuote:async()=>quote,writeHold:async()=>{throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});}}),{name:'TransactionCanceledException'});
});
test('published Cloudflare dummy response needs an explicit staging test switch',()=>{
 const input={secret:'1x0000000000000000000000000000000AA',token:payload.turnstileToken,
  data:{success:true,hostname:'example.com'},origin:'http://localhost:4321'};
 assert.equal(validChallengeResponse({...input,testEnabled:false}),false);
 assert.equal(validChallengeResponse({...input,testEnabled:true}),true);
 assert.equal(validChallengeResponse({...input,testEnabled:true,token:'arbitrary-token'}),false);
 assert.equal(validChallengeResponse({...input,secret:'real-secret',testEnabled:true}),false);
 assert.equal(validChallengeResponse({...input,secret:'real-secret',data:{success:true,hostname:'localhost',action:'lesbuttes-staging-booking'}}),true);
});
test('production environment and production website origins remain denied',async()=>{
 const env={BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',
  BOOKING_ENVIRONMENT:'staging',BOOKING_STAGING_GUEST_WRITES:'true',ALLOWED_PREVIEW_ORIGIN:'http://localhost:4321'};
 for(const override of [{BOOKING_ENVIRONMENT:'production'},{ALLOWED_PREVIEW_ORIGIN:'https://lesbuttes.com'}]){
  const handler=createGuestHandler({env:{...env,...override},db:{send:()=>assert.fail('unexpected database access')}});
  assert.equal((await handler({headers:{origin:override.ALLOWED_PREVIEW_ORIGIN??env.ALLOWED_PREVIEW_ORIGIN}})).statusCode,403);
 }
});
