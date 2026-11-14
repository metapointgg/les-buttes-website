import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
const bookingId='12345678-1234-1234-1234-123456789abc';
const base={bookingId,cottage:'Geranium',checkIn:'2027-08-28',checkOut:'2027-09-04'};
const fixture={
 approval_payment:{booking:{...base,status:'APPROVED_AWAITING_PAYMENT',approvedAmountPence:163000},
 checkout:{bookingId,status:'PENDING',currency:'GBP',amountPence:163000,
 hostedCheckoutUrl:'https://checkout.sumup.com/pay/c-123e4567-e89b-42d3-a456-426614174000'}},
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
 assert.match(rendered.body,/confirmed once your payment has been verified/);
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
 assert.doesNotMatch(msg.body,/refund/i);
 assert.match(msg.body,/Your booking has been cancelled/);
 assert.doesNotMatch(msg.body,/dates have been released/i);
 assert.match(msg.body,/did not request this cancellation/);
 assert.match(msg.body,/contact us immediately/);
 assert.match(msg.html,/contact us immediately/);
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

test('owner review email includes actionable guest details without leaking them to guest emails',()=>{
 const requested={...base,status:'REQUESTED',guestName:'A & B Guest',guestEmail:'guest@example.com',
   guestTelephone:'+44 1481 000000',guests:2};
 const owner=renderBookingLifecycleEmail({type:'owner_request',booking:requested});
 const guest=renderBookingLifecycleEmail({type:'requested',booking:requested});
 assert.match(owner.body,/Guest: A & B Guest/);
 assert.match(owner.body,/Owner management: https:\/\/lesbuttes\.ozanne-family\.com/);
 assert.match(owner.html,/Review booking request/);
 assert.match(owner.html,/A &amp; B Guest/);
 assert.match(owner.html,/GUEST DETAILS/);
 assert.doesNotMatch(guest.body,/Guest: A & B Guest|Owner management:/);
 assert.doesNotMatch(guest.html,/Review booking request|GUEST DETAILS/);
 assert.throws(()=>renderBookingLifecycleEmail({type:'owner_request',booking:{...requested,guestTelephone:'invalid'}}));
});

test('branded HTML keeps verified stay, secure payment URL and readable plain text',()=>{
 const {body,html}=renderBookingLifecycleEmail({type:'approval_payment',...fixture.approval_payment});
 assert.match(html,/Les Buttes/);
 assert.match(html,/background:#194c3d/);
 assert.match(html,/Pay securely with SumUp/);
 assert.match(html,/checkout\.sumup\.com\/pay\/c-123e4567/);
 assert.match(html,/£1630\.00/);
 assert.match(body,/checkout\.sumup\.com\/pay\/c-123e4567/);
 const cancelled=renderBookingLifecycleEmail({type:'cancelled',...fixture.cancelled});
 assert.doesNotMatch(cancelled.html,/refund/i);
 assert.match(cancelled.html,/Your booking has been cancelled/);
});

test('branded emails escape injected markup and never invent a payment button',()=>{
 const cancelled=renderBookingLifecycleEmail({type:'cancelled',...fixture.cancelled,reason:'<script>alert(1)</script>'});
 assert.doesNotMatch(cancelled.html,/<script>/);
 assert.doesNotMatch(cancelled.html,/Pay securely with SumUp/);
 const requested=renderBookingLifecycleEmail({type:'requested',booking:{...base,status:'REQUESTED'}});
 assert.match(requested.html,/REQUEST RECEIVED/);
 assert.doesNotMatch(requested.html,/checkout\.sumup\.com/);
});

test('email body and stay summary remain white without cream text strips',()=>{
 const message=renderBookingLifecycleEmail({type:'approval_payment',...fixture.approval_payment});
 assert.match(message.html,/background:#ffffff/);
 assert.doesNotMatch(message.html,/background:#f7f3e9/);
 assert.match(message.html,/border-left:3px solid #b47b3a/);
 assert.match(message.html,/background:#194c3d/);
});

test('production lifecycle emails contain no preview, illustrative or staging copy',()=>{
 const requested={...base,status:'REQUESTED',guestName:'Example Guest',guestEmail:'guest@example.com',
  guestTelephone:'+44 1481 000000',guests:2,quotedPriceGBP:'735.00'};
 const scenarios=[
  ...Object.entries(fixture).map(([type,data])=>({type,...data})),
  {type:'requested',booking:requested},
  {type:'owner_request',booking:requested}
 ];
 for(const input of scenarios){
  const message=renderBookingLifecycleEmail(input);
  for(const field of [message.subject,message.body,message.html]){
   assert.doesNotMatch(field,/DESIGN TEST|TEST ONLY|PREVIEW|ILLUSTRATIVE|STAGING|SANDBOX|FAKE BOOKING|NO BOOKING|in a real (approval|message)|OWNER EMAIL TEST/i,input.type);
  }
  assert.match(message.html,/background:#ffffff/);
 }
 const approved=renderBookingLifecycleEmail({type:'approval_payment',...fixture.approval_payment});
 assert.equal(approved.subject,'Les Buttes — Booking approved: payment required');
 assert.match(approved.body,/Amount due: £1630\.00/);
 assert.doesNotMatch(approved.body,/illustrative|test|preview/i);
 assert.match(approved.html,/>Pay securely with SumUp<\/a>/);
 assert.match(approved.html,/href="https:\/\/checkout\.sumup\.com\/pay\/c-123e4567-e89b-42d3-a456-426614174000"/);
 const owner=renderBookingLifecycleEmail({type:'owner_request',booking:requested});
 assert.equal(owner.subject,'Les Buttes — New booking request awaiting approval');
 assert.match(owner.html,/Review booking request/);
});

test('deposit approval email states total, first payment and final balance without claiming full payment',()=>{
 const booking={...base,status:'APPROVED_AWAITING_PAYMENT',approvedAmountPence:80500,
  balancePence:40250,balanceDueDate:'2027-04-24'};
 const checkout={...fixture.approval_payment.checkout,amountPence:40250};
 const result=renderBookingLifecycleEmail({type:'approval_payment',booking,checkout});
 assert.match(result.body,/Amount due: £402\.50/);
 assert.match(result.body,/Total holiday price: £805\.00/);
 assert.match(result.body,/Remaining balance: £402\.50 due 2027-04-24/);
 assert.match(result.html,/Pay securely with SumUp/);
});

test('personalised monthly balance reminders use durable private payment page, not expiring SumUp links',()=>{
 const token='A'.repeat(43);
 const message=renderBookingLifecycleEmail({type:'balance_reminder',reminderStage:3,
  booking:{...base,status:'CONFIRMED',guestName:'Dave Smith',
   balancePence:40250,balanceDueDate:'2027-08-14',balanceAccessToken:token}});
 assert.match(message.body,/Dear Dave,/);
 assert.match(message.body,/three months/);
 assert.match(message.body,/https:\/\/lesbuttes.com\/pay\/#booking=/);
 assert.match(message.html,/Pay your balance/);
 assert.doesNotMatch(message.html,/checkout\.sumup\.com/);
 for(const invalid of ['invalid','https://attacker.invalid']){
  assert.throws(()=>renderBookingLifecycleEmail({type:'balance_reminder',reminderStage:3,
   booking:{...base,status:'CONFIRMED',guestName:'Dave Smith',
    balancePence:40250,balanceDueDate:'2027-08-14',balanceAccessToken:invalid}}));
 }
});
