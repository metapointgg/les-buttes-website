import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProductionSesMessage} from './booking-production-ses-policy.mjs';
import {createProductionSesTransport} from './booking-production-ses-transport.mjs';
import {dispatchRequestedProductionBookingEmails,dispatchProductionBookingLifecycleEmail} from './booking-production-email-dispatch.mjs';

const id='123e4567-e89b-42d3-a456-426614174000';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const env={BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:table,EMAILS_ENABLED:'true',LIVE_EMAILS_APPROVED:'true',
 BOOKING_SES_REGION:'us-east-1',BOOKING_SES_FROM:'bookings@lesbuttes.com',BOOKING_OWNER_EMAIL:'mike@lesbuttes.com',
 BOOKING_SES_SIMULATOR_ENABLED:'false',BOOKING_REQUEST_DISPATCH_ENABLED:'true',BOOKING_LIFECYCLE_DISPATCH_ENABLED:'true'};
const base={bookingId:id,type:'requested',templateId:'requested-v1',to:'guest@example.com',subject:'Your booking request',body:'Your request has been received.'};

test('production email policy requires every independent gate and approved addresses',()=>{
 assert.equal(validateProductionSesMessage({env,...base}).allowed,true);
 assert.equal(validateProductionSesMessage({...base,type:'owner_request',to:'mike@lesbuttes.com',env}).allowed,true);
 for(const patch of [{EMAILS_ENABLED:'false'},{LIVE_EMAILS_APPROVED:'false'},{BOOKING_SES_FROM:'info@lesbuttes.com'},
  {BOOKING_OWNER_EMAIL:'owner@example.com'},{BOOKING_SES_SIMULATOR_ENABLED:'true'}])
  assert.equal(validateProductionSesMessage({env:{...env,...patch},...base}).allowed,false);
 assert.equal(validateProductionSesMessage({...base,type:'owner_request',to:'other@example.com',env}).allowed,false);
 assert.equal(validateProductionSesMessage({...base,type:'confirmed',to:'mike@lesbuttes.com',env}).allowed,false);
});

test('production transport is pinned to us-east-1 and the approved domain sender',async()=>{
 let region,input,destroyed=0;
 const transport=createProductionSesTransport({env,clientFactory:r=>(region=r,{send:async command=>(input=command,{MessageId:'ses-safe'}),destroy:()=>destroyed++}),commandFactory:x=>x});
 const result=await transport.send(base);
 assert.equal(region,'us-east-1');assert.equal(input.Source,'bookings@lesbuttes.com');
 assert.deepEqual(input.Destination.ToAddresses,['guest@example.com']);assert.equal(result.status,'ACCEPTED_BY_SES_NOT_DELIVERED');
 assert.equal(destroyed,1);
 const htmlTransport=createProductionSesTransport({env,clientFactory:()=>({send:async command=>(input=command,{MessageId:'ses-html'}),destroy:()=>{}}),commandFactory:x=>x});
 await htmlTransport.send({...base,html:'<!doctype html><html><body><p>Booking request</p></body></html>'});
 assert.match(input.Message.Body.Html.Data,/Booking request/);
 assert.equal(input.Message.Body.Text.Data,base.body);
});

test('production request dispatch reads the authoritative record and prepares guest and owner messages',async()=>{
 const booking={id,source:'direct',status:'REQUESTED',reservationStatus:'PENDING_REVIEW',units:['geranium'],
  start:'2027-04-03',end:'2027-04-10',guestEmail:'guest@example.com'};
 const messages=[];
 const results=await dispatchRequestedProductionBookingEmails({db:{send:async()=>({Item:booking})},table,bookingId:id,env,
  transport:{send:async()=>{}},send:async({message})=>(messages.push(message),{status:'ACCEPTED_BY_SES_NOT_DELIVERED'})});
 assert.deepEqual(messages.map(x=>[x.type,x.to]),[['requested','guest@example.com'],['owner_request','mike@lesbuttes.com']]);
 assert.equal(results.length,2);
});

test('production approval email uses only the registered hosted checkout',async()=>{
 const booking={id,source:'direct',status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT',units:['geranium'],
  start:'2027-04-03',end:'2027-04-10',guestEmail:'guest@example.com',approvedAmountGBP:735,
  holdExpiresAt:Math.floor(Date.now()/1000)+3600};
 const checkout={bookingId:id,status:'PENDING',currency:'GBP',amountPence:73500,
  hostedCheckoutUrl:'https://checkout.sumup.com/pay/c-123e4567-e89b-42d3-a456-426614174000'};
 let message;
 await dispatchProductionBookingLifecycleEmail({db:{send:async command=>({Item:command.input.Key.SK==='META'?booking:checkout})},
  table,bookingId:id,type:'approval_payment',env,transport:{send:async()=>{}},
  send:async args=>(message=args.message,{status:'ACCEPTED_BY_SES_NOT_DELIVERED'})});
 assert.equal(message.to,'guest@example.com');assert.match(message.body,/£735.00/);assert.match(message.body,/checkout\.sumup\.com/);
});
