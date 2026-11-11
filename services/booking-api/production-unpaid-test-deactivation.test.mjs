import test from 'node:test';
import assert from 'node:assert/strict';
import {deactivateAndReleaseControlledUnpaidBooking} from './production-unpaid-test-deactivation.mjs';

const id='c77c77c7-7777-4777-8777-777777777777';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const env={
 BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:table,
 PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true',LIVE_BOOKINGS_APPROVED:'true',
 MANAGEMENT_WRITES_ENABLED:'true',MANAGEMENT_CHECKOUT_ENABLED:'true',
 BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'true'
};
const booking={id,source:'direct',synthetic:false,units:['geranium'],
 start:'2027-04-10',end:'2027-04-17',guestEmail:'mike@un1ty.gg',
 quote:{currency:'GBP',totalGBP:'735.00'},approvedAmountGBP:1,
 status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT'};
const checkout={bookingId:id,checkoutId:'a1b2c3d4-1234-4234-8234-123456789abc',
 reference:'lb-2cdab3d3456789000000000000000000',amountPence:100,currency:'GBP',status:'PENDING'};
const remote={id:checkout.checkoutId,checkout_reference:checkout.reference,
 merchant_code:'M9BE4KMN',currency:'GBP',amount:1,
 status:'PENDING',transactions:[]};
function fixture(states=['PENDING','EXPIRED']){
 const calls=[];let reads=0;
 const db={send:async command=>{
  if(command.constructor.name==='GetCommand')return {Item:command.input.Key.SK==='META'?booking:checkout};
  calls.push(command);
  return {};
 }};
 const sumup={merchantCode:'M9BE4KMN',
  retrieveCheckout:async()=>({...remote,status:states[Math.min(reads++,states.length-1)]}),
  deactivateCheckout:async checkoutId=>{calls.push({kind:'deactivate',checkoutId});return {...remote,status:'EXPIRED'};}};
 return {db,sumup,calls};
}
const props={table,bookingId:id,identity:{role:'owner',subject:'test-owner'},
 reason:'Completed unpaid guest payment link test',env,nowEpoch:1800000000,
 ssmFactory:()=>({destroy(){}})};
test('a provider-confirmed EXPIRED checkout precedes the atomic seven-night release',async()=>{
 const f=fixture();
 const result=await deactivateAndReleaseControlledUnpaidBooking({
  ...props,db:f.db,clientFactory:async()=>f.sumup
 });
 assert.equal(result.status,'CANCELLED');
 assert.equal(result.refundInitiated,false);
 assert.equal(result.affectedNights,7);
 assert.equal(f.calls[0].kind,'deactivate');
 const changes=f.calls[1].input.TransactItems;
 assert.equal(changes.length,10);
 assert.equal(changes.filter(x=>x.Delete).length,7);
 assert.equal(changes[0].Update.ExpressionAttributeValues[':id'],id);
 assert.equal(changes[1].Update.ExpressionAttributeValues[':expired'],'EXPIRED');
});
test('a paid or still-payable checkout NEVER releases inventory',async()=>{
 for(const states of [['PAID'],['PENDING','PENDING']]){
  const f=fixture(states);
  await assert.rejects(
   deactivateAndReleaseControlledUnpaidBooking({...props,db:f.db,clientFactory:async()=>f.sumup}),
   /Checkout already processed|Provider did not verify/
  );
  assert.equal(f.calls.some(c=>c.input?.TransactItems),false);
 }
});
test('wrong live release gate, owner, booking status or price refuses provider interaction',async()=>{
 const attempts=[
  {env:{...env,BOOKING_CONTROLLED_TEST_ONLY_ENABLED:'false'}},
  {identity:{role:'viewer',subject:'test-owner'}},
  {db:{send:async()=>({Item:{...booking,approvedAmountGBP:735}})}}
 ];
 for(const override of attempts){
  let called=false;
  await assert.rejects(deactivateAndReleaseControlledUnpaidBooking({
   ...props,db:{send:async()=>({Item:booking})},...override,
   clientFactory:async()=>{called=true;return {};}
  }));
  assert.equal(called,false);
 }
});
