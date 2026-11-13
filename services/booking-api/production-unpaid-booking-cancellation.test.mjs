import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelUnpaidProductionBooking} from './production-unpaid-booking-cancellation.mjs';

const id='c77c77c7-7777-4777-8777-777777777777';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const env={BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:table,
 PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true',LIVE_BOOKINGS_APPROVED:'true',
 MANAGEMENT_WRITES_ENABLED:'true',MANAGEMENT_CHECKOUT_ENABLED:'true',
 BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'false'};
const booking={id,source:'direct',GSI1PK:'BOOKING_REQUESTS',synthetic:false,units:['geranium'],
 start:'2027-05-08',end:'2027-05-15',approvedAmountGBP:805,
 status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT'};
const checkout={bookingId:id,checkoutId:'a1b2c3d4-1234-4234-8234-123456789abc',
 reference:'lb-2cdab3d3456789000000000000000000',amountPence:80500,currency:'GBP',status:'PENDING'};
const remote={id:checkout.checkoutId,checkout_reference:checkout.reference,
 merchant_code:'M9BE4KMN',currency:'GBP',amount:805,status:'PENDING',transactions:[]};
const inputs={table,bookingId:id,identity:{role:'owner',subject:'live-owner'},
 reason:'Guest has requested cancellation before payment',env,nowEpoch:1800000000,
 ssmFactory:()=>({destroy(){}})};
const fixture=({states=['PENDING','EXPIRED'],overrideBooking={},overrideCheckout={},
  overrideRemote={}}={})=>{
 let reads=0;const calls=[];
 const db={send:async command=>{
  if(command.constructor.name==='GetCommand'){
   return {Item:command.input.Key.SK==='META'?{...booking,...overrideBooking}:{...checkout,...overrideCheckout}};
  }
  calls.push(command);return {};
 }};
 const sumup={merchantCode:'M9BE4KMN',
  retrieveCheckout:async()=>({...remote,...overrideRemote,status:states[Math.min(reads++,states.length-1)]}),
  deactivateCheckout:async checkoutId=>{calls.push({kind:'deactivate',checkoutId});return {...remote,status:'EXPIRED'};}};
 return {db,sumup,calls};
};
test('owner can cancel an unpaid £805 production reservation and release its seven slots after provider verification',async()=>{
 const f=fixture();
 const response=await cancelUnpaidProductionBooking({...inputs,db:f.db,clientFactory:async()=>f.sumup});
 assert.deepEqual([response.status,response.paymentCheckout,response.affectedNights,response.refundInitiated],
  ['CANCELLED','EXPIRED',7,false]);
 assert.equal(f.calls[0].kind,'deactivate');
 const tx=f.calls[1].input.TransactItems;
 assert.equal(tx.length,10);
 assert.deepEqual(tx.slice(2,9).map(x=>x.Delete.Key.SK),
  ['DATE#2027-05-08','DATE#2027-05-09','DATE#2027-05-10','DATE#2027-05-11',
   'DATE#2027-05-12','DATE#2027-05-13','DATE#2027-05-14']);
 assert.match(tx[0].Update.ConditionExpression,/attribute_not_exists\(paymentTransactionId\)/);
 assert.match(tx[1].Update.ConditionExpression,/checkoutId = :checkout/);
 assert.equal(tx[9].Put.Item.refundInitiated,false);
});
test('both cottages and 21 nights use actual booking inventory rather than fixed test dates',async()=>{
 const f=fixture({overrideBooking:{units:['geranium','honeysuckle'],start:'2027-08-07',end:'2027-08-28'}});
 const response=await cancelUnpaidProductionBooking({...inputs,db:f.db,clientFactory:async()=>f.sumup});
 assert.equal(response.affectedNights,42);
 const tx=f.calls[1].input.TransactItems;
 assert.equal(tx.filter(x=>x.Delete).length,42);
 assert.equal(tx[2].Delete.Key.PK,'UNIT#geranium');
 assert.equal(tx[23].Delete.Key.PK,'UNIT#honeysuckle');
});
test('paid, pending-after-delete or contradictory SumUp evidence never releases slots',async()=>{
 for(const config of [
  {states:['PAID']},{states:['PENDING','PENDING']},
  {overrideRemote:{transactions:[{status:'SUCCESSFUL'}]}},
  {overrideRemote:{merchant_code:'MGV5J9QV'}},
  {overrideRemote:{transactions:undefined}},
  {overrideRemote:{amount:800}}
 ]){
  const f=fixture(config);
  await assert.rejects(cancelUnpaidProductionBooking({...inputs,db:f.db,clientFactory:async()=>f.sumup}));
  assert.equal(f.calls.some(x=>x.input?.TransactItems),false);
 }
});
test('wrong role, booking state or test-only gate fails without contacting provider',async()=>{
 for(const override of [
  {identity:{role:'viewer',subject:'viewer'}},
  {env:{...env,BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'true'}},
  {overrideBooking:{status:'CONFIRMED'}},
  {overrideBooking:{paidAt:'2026-11-13T20:00:00Z'}},
  {overrideBooking:{paymentTransactionId:'transaction'}},
  {overrideBooking:{start:'2027-08-08',end:'2027-08-28'}}
 ]){
  const {overrideBooking, ...props}=override;
  const f=fixture({overrideBooking});
  let contacted=false;
  await assert.rejects(cancelUnpaidProductionBooking({...inputs,...props,db:f.db,
   clientFactory:async()=>{contacted=true;return f.sumup;}}));
  assert.equal(contacted,false);
  assert.equal(f.calls.some(x=>x.input?.TransactItems),false);
 }
});
