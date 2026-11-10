import test from 'node:test';
import assert from 'node:assert/strict';
import {authorisedProductionPaymentSchedule,reconcileScheduledProductionPayments}
 from './production-payment-schedule.mjs';

const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const env={BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:table,
 BOOKING_AUTOMATIC_RECONCILIATION_ENABLED:'true',PAYMENTS_ENABLED:'true',
 LIVE_PAYMENTS_APPROVED:'true',MANAGEMENT_WRITES_ENABLED:'true',
 MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED:'true',LIVE_BOOKINGS_APPROVED:'true',
 EMAILS_ENABLED:'true',LIVE_EMAILS_APPROVED:'true',BOOKING_LIFECYCLE_DISPATCH_ENABLED:'true',
 BOOKING_SES_REGION:'us-east-1',BOOKING_SES_SIMULATOR_ENABLED:'false',
 BOOKING_SES_FROM:'bookings@lesbuttes.com',BOOKING_OWNER_EMAIL:'mike@lesbuttes.com'};
const event={source:'aws.events','detail-type':'Scheduled Event',account:'145608514666',
 region:'eu-west-2',resources:['arn:aws:events:eu-west-2:145608514666:rule/les-buttes-production-payment-reconciliation']};
const id='11111111-1111-4111-8111-111111111111';

test('production scheduler is default-off and requires exact EventBridge identity and every financial/email gate',()=>{
 assert.equal(authorisedProductionPaymentSchedule(event,env),true);
 for(const key of ['BOOKING_AUTOMATIC_RECONCILIATION_ENABLED','PAYMENTS_ENABLED',
  'LIVE_PAYMENTS_APPROVED','MANAGEMENT_WRITES_ENABLED','MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED',
  'LIVE_BOOKINGS_APPROVED','EMAILS_ENABLED','LIVE_EMAILS_APPROVED',
  'BOOKING_LIFECYCLE_DISPATCH_ENABLED']){
  assert.equal(authorisedProductionPaymentSchedule(event,{...env,[key]:'false'}),false,key);
 }
 for(const altered of [
  {...event,account:'000000000000'},
  {...event,region:'us-east-1'},
  {...event,source:'browser'},
  {...event,resources:[]},
  {...event,resources:['arn:aws:events:eu-west-2:145608514666:rule/other']},
  {...event,'detail-type':'Payment succeeded'},{}
 ])assert.equal(authorisedProductionPaymentSchedule(altered,env),false);
 assert.equal(authorisedProductionPaymentSchedule(event,{...env,BOOKING_ENVIRONMENT:'staging'}),false);
 assert.equal(authorisedProductionPaymentSchedule(event,{...env,BOOKINGS_TABLE:'booking-staging'}),false);
});

test('scheduled production confirmation uses provider verification and a separate SES outbox, not payment assertions',async()=>{
 const booking={id,source:'direct',synthetic:false,status:'APPROVED_AWAITING_PAYMENT',
  reservationStatus:'AWAITING_PAYMENT',holdExpiresAt:200};
 const calls=[];
 const db={send:async command=>{
  const p=command.input;
  if(p.IndexName)return {Items:[{id,status:'APPROVED_AWAITING_PAYMENT'}]};
  if(p.Key?.SK==='META')return {Item:booking};
  if(p.Key?.SK==='PAYMENT#CHECKOUT')return {Item:{checkoutId:'checkout-1234',amountPence:73500}};
  throw Error('Unexpected database read');
 }};
 const count=await reconcileScheduledProductionPayments(event,{env,db,now:()=>100,
  reconcile:async args=>{calls.push({type:'reconcile',args});
   return {bookingId:id,status:'CONFIRMED'};},
  dispatch:async args=>{calls.push({type:'dispatch',args});
   return {status:'ACCEPTED_BY_SES_NOT_DELIVERED'};},
  transportFactory:()=>({send:async()=>{throw Error('No real SES call in unit test');}})
 });
 assert.deepEqual(count,{confirmed:1,pending:0,review:0,notificationReview:0,checked:1});
 assert.deepEqual(calls.map(x=>x.type),['reconcile','dispatch']);
 assert.equal(calls[0].args.identity.subject,'system:production-scheduled-payment-reconciliation');
 assert.equal(calls[1].args.type,'confirmed');
});

test('scheduled production loop treats unpaid checkout as pending, never confirms or emails',async()=>{
 const booking={id,source:'direct',synthetic:false,status:'APPROVED_AWAITING_PAYMENT',
  reservationStatus:'AWAITING_PAYMENT',holdExpiresAt:200};
 let emails=0;
 const db={send:async command=>command.input.IndexName?
  {Items:[{id,status:'APPROVED_AWAITING_PAYMENT'}]}:
  {Item:command.input.Key.SK==='META'?booking:{checkoutId:'checkout-1234'}}};
 const result=await reconcileScheduledProductionPayments(event,{env,db,now:()=>100,
  reconcile:async()=>{throw Error('Payment not verified: Provider has not confirmed payment');},
  dispatch:async()=>{emails++;}});
 assert.equal(result.pending,1);
 assert.equal(result.confirmed,0);
 assert.equal(emails,0);
});
