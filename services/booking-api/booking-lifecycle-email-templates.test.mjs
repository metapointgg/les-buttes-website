import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
const bookingId='12345678-1234-1234-1234-123456789abc';
const base={bookingId,cottage:'Geranium',checkIn:'2027-08-28',checkOut:'2027-09-04'};
const fixture={
 approval_payment:{booking:{...base,status:'APPROVED_AWAITING_PAYMENT',approvedAmountPence:163000},
 checkout:{bookingId,status:'PENDING',currency:'GBP',amountPence:163000,
 hostedCheckoutUrl:'https://checkout.sumup.com/pay/fixture'}},
 confirmed:{booking:{...base,status:'CONFIRMED',paymentVerified:true}},
 declined:{booking:{...base,status:'DECLINED'}},
 cancelled:{booking:{...base,status:'CANCELLED'}},
 refund_confirmed:{booking:{...base,status:'CANCELLED',refundStatus:'REFUNDED',refundedAmountPence:36750}},
 hold_expired:{booking:{...base,status:'EXPIRED'}},
 delivery_failure:{booking:{...base,status:'DELIVERY_FAILURE'}}
};
test('LB-09 covers all lifecycle types with deterministic, bounded text and stable template IDs',()=>{
 for(const [type,data] of Object.entries(fixture)){
  const rendered=renderBookingLifecycleEmail({type,...data});
  assert.equal(rendered.bookingId,bookingId);
  assert.ok(rendered.templateId.endsWith('_v1'));
  assert.match(rendered.subject,/Les Buttes/);
  assert.match(rendered.body,/Geranium \| 2027-08-28 to 2027-09-04/);
  assert.match(rendered.body,new RegExp(bookingId));
  assert.equal(rendered.body,renderBookingLifecycleEmail({type,...data}).body);
  assert.ok(rendered.body.length<15000);
 }
});
test('LB-09 payment instructions require approved booking and matching GBP checkout',()=>{
 const data=fixture.approval_payment;
 const rendered=renderBookingLifecycleEmail({type:'approval_payment',...data});
 assert.match(rendered.body,/£1630\.00/);
 assert.match(rendered.body,/not confirmed until payment has been verified/);
 for(const broken of [
  {booking:{...data.booking,status:'REQUESTED'}},
  {booking:{...data.booking,approvedAmountPence:180000}},
  {checkout:{...data.checkout,currency:'EUR'}},
  {checkout:{...data.checkout,bookingId:'aaaaaaaa-1234-1234-1234-123456789abc'}},
  {checkout:{...data.checkout,hostedCheckoutUrl:'https://checkout.sumup.com.evil.test/pay'}},
  {checkout:{...data.checkout,hostedCheckoutUrl:'http://checkout.sumup.com/pay'}},
  {checkout:{...data.checkout,hostedCheckoutUrl:'https://checkout.sumup.com/pay#fragment'}}
 ])assert.throws(()=>renderBookingLifecycleEmail({type:'approval_payment',
  ...data,...broken}),undefined,JSON.stringify(broken));
});
test('LB-09 cannot confirm before verification or promise refund on cancellation',()=>{
 assert.throws(()=>renderBookingLifecycleEmail({type:'confirmed',
  booking:{...base,status:'CONFIRMED',paymentVerified:false}}));
 assert.throws(()=>renderBookingLifecycleEmail({type:'confirmed',
  booking:{...base,status:'APPROVED_AWAITING_PAYMENT',paymentVerified:true}}));
 const msg=renderBookingLifecycleEmail({type:'cancelled',...fixture.cancelled});
 assert.match(msg.body,/does not confirm a refund/);
 const refund=renderBookingLifecycleEmail({type:'refund_confirmed',...fixture.refund_confirmed});
 assert.match(refund.body,/£367\.50/);
});
test('LB-09 rejects malformed dates, invented cottages, control characters and unknown types',()=>{
 for(const booking of [
  {...base,checkIn:'2027-02-30'},
  {...base,checkOut:'2027-08-27'},
  {...base,cottage:'Other Cottage'},
  {...base,cottage:'Geranium\r\nBcc:evil@example.com'},
  {...base,bookingId:'not-a-booking-id'}
 ])assert.throws(()=>renderBookingLifecycleEmail({type:'declined',
  booking:{...booking,status:'DECLINED'}}));
 assert.throws(()=>renderBookingLifecycleEmail({type:'payment_received',booking:base}));
});
