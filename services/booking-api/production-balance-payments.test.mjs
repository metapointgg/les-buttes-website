import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceReference,ensureBalanceCheckout,reconcileBalancePayment} from './production-balance-payments.mjs';
import {currentBalanceReminderStage} from './production-balance-reminders.mjs';
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const id='11111111-1111-4111-8111-111111111111';
const env={BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:table,
 PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true',BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'false'};
const identity={role:'system',subject:'system:balance-reconciliation'};
const schedule={totalPence:80500,dueNowPence:40250,balancePence:40250,
 dueDate:'2027-04-24',reminders:[{months:3,date:'2027-02-08'},{months:2,date:'2027-03-08'},{months:1,date:'2027-04-08'}]};
const booking={id,source:'direct',synthetic:false,status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paymentStatus:'PARTIALLY_PAID',paidAmountPence:40250,balanceDuePence:40250,
 paymentTransactionId:'first-confirmed-payment',paymentSchedule:schedule,
 approvedAmountGBP:805,start:'2027-05-08',end:'2027-05-15',units:['geranium'],
 guestName:'Dave Guest'};
const checkout={PK:'BOOKING#'+id,SK:'PAYMENT#BALANCE_CHECKOUT',bookingId:id,
 checkoutId:'11111111-2222-4333-8444-555555555555',
 reference:balanceReference(id),amountPence:40250,currency:'GBP',
 status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/pay/c-11111111-2222-4333-8444-555555555555'};
const sumup={merchantCode:'M9BE4KMN',
 listCheckoutsByReference:async()=>[],
 createCheckout:async()=>({...checkout}),
 retrieveCheckout:async()=>({id:checkout.checkoutId,checkout_reference:checkout.reference,
  merchant_code:'M9BE4KMN',currency:'GBP',amount:402.5,status:'PAID',
  transactions:[{id:'77777777-7777-4777-8777-777777777777',
   status:'SUCCESSFUL',currency:'GBP',merchant_code:'M9BE4KMN',amount:402.5}]})};
const store=({existing=checkout,record=booking}={})=>{
 const calls=[];
 const db={send:async command=>{
  const key=command.input.Key;
  if(key?.SK==='META')return {Item:record};
  if(key?.SK==='PAYMENT#BALANCE_CHECKOUT')return {Item:existing};
  if(key?.SK==='PAYMENT#BALANCE_CREATION_CLAIM')return {};
  calls.push(command.input);return {};
 }};
 return {db,calls};
};
test('balance creation uses independent reference and one permanent claim before SumUp POST',async()=>{
 const fixture=store({existing:null});let calls=0;
 const api={...sumup,createCheckout:async()=>{calls++;return {...checkout};}};
 const result=await ensureBalanceCheckout({db:fixture.db,table,bookingId:id,identity,sumup:api,env});
 assert.equal(result.status,'REGISTERED');
 assert.equal(calls,1);
 assert.equal(fixture.calls.length,2);
 assert.equal(fixture.calls[0].Item.SK,'PAYMENT#BALANCE_CREATION_CLAIM');
 assert.equal(fixture.calls[1].TransactItems[1].Put.Item.amountPence,40250);
 const again=await ensureBalanceCheckout({db:store().db,table,bookingId:id,identity,sumup:api,env});
 assert.equal(again.status,'ALREADY_REGISTERED');
 assert.equal(calls,1);
});
test('provider-verified final balance completes ledger and writes a unique transaction claim',async()=>{
 const fixture=store();
 const result=await reconcileBalancePayment({db:fixture.db,table,bookingId:id,identity,sumup,env});
 assert.equal(result.status,'PAID_IN_FULL');
 assert.equal(result.balanceDuePence,0);
 const tx=fixture.calls[0].TransactItems;
 assert.equal(tx[0].Update.ExpressionAttributeValues[':total'],80500);
 assert.equal(tx[0].Update.ExpressionAttributeValues[':zero'],0);
 assert.equal(tx[2].Put.Item.paymentStage,'BALANCE');
});
test('unpaid or mismatched provider checkout never updates the ledger',async()=>{
 for(const remote of [
  {...await sumup.retrieveCheckout(),status:'PENDING',transactions:[]},
  {...await sumup.retrieveCheckout(),amount:404.5},
  {...await sumup.retrieveCheckout(),merchant_code:'MGV5J9QV'}
 ]){
  const f=store();
  await assert.rejects(reconcileBalancePayment({db:f.db,table,bookingId:id,identity,
   sumup:{...sumup,retrieveCheckout:async()=>remote},env}));
  assert.equal(f.calls.length,0);
 }
});
test('reminder stages use latest due milestone, stop when fully paid and never send after arrival',()=>{
 const expectAt=[['2027-01-10',null],['2027-02-08',3],['2027-03-08',2],
  ['2027-04-08',1],['2027-04-24',0],['2027-05-08',null]];
 for(const [today,expected] of expectAt)
  assert.equal(currentBalanceReminderStage({booking,today}),expected);
 assert.equal(currentBalanceReminderStage({booking:{...booking,paymentStatus:'PAID_IN_FULL'},today:'2027-04-24'}),null);
});
test('3-month reminder personally addresses guest and contains verified SumUp pay-now link',()=>{
 const render=renderBookingLifecycleEmail({type:'balance_reminder',reminderStage:3,
  booking:{bookingId:id,cottage:'Geranium',checkIn:'2027-05-08',checkOut:'2027-05-15',
   status:'CONFIRMED',guestName:'Dave Guest',balancePence:40250,balanceDueDate:'2027-04-24'},
  checkout});
 assert.match(render.body,/Dear Dave,/);
 assert.match(render.body,/three months/);
 assert.match(render.body,/Otherwise, no action is needed/);
 assert.match(render.html,/Pay securely with SumUp/);
 assert.equal(render.templateId,'balance_reminder_3_v1');
});
