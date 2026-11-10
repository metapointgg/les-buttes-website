// LB-09 staging-only confirmed-booking dispatch. Not attached to public API routes.
// Reads authoritative state afresh; durable outbox prevents duplicate SES sends.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {prepareConfirmedGuestEmail} from './booking-confirmation-email-preparation.mjs';
import {sendBookingEmailOnce} from './booking-email-outbox.mjs';
import {prepareRequestedBookingEmails} from './booking-request-email-preparation.mjs';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function dispatchRequestedBookingEmails({db,table,bookingId,transport,
 env=process.env,send=sendBookingEmailOnce}={}){
 if(!db?.send||!transport?.send||!TABLE.test(table??'')||
  env.BOOKING_ENVIRONMENT!=='staging'||env.BOOKING_REQUEST_DISPATCH_ENABLED!=='true'||
  !ID.test(bookingId??''))throw Error('Staging request dispatch disabled');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(booking?.id!==bookingId)throw Error('Authoritative booking unavailable');
 const simulator=env.BOOKING_SES_SIMULATOR_ENABLED==='true';
 if(simulator&&(booking.synthetic!==true||booking.guestEmail!=='test@example.invalid'))
  throw Error('SES simulator requires synthetic booking');
 const messages=prepareRequestedBookingEmails(simulator?{...booking,guestEmail:'success@simulator.amazonses.com'}:booking,
  {ownerEmail:simulator?'success@simulator.amazonses.com':env.BOOKING_OWNER_EMAIL});
 const results=[];
 for(const message of messages)results.push(await send({db,table,transport,env,message}));
 return results;
}
export async function dispatchConfirmedGuestEmail({db,table,bookingId,transport,
 env=process.env,send=sendBookingEmailOnce}={}){
 if(!db?.send||!transport?.send||!TABLE.test(table??'')||
    env.BOOKING_ENVIRONMENT!=='staging'||env.BOOKING_CONFIRMATION_DISPATCH_ENABLED!=='true'||
    !ID.test(bookingId??''))throw Error('Staging confirmation dispatch disabled');
 const response=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 const booking=response?.Item;
 if(!booking||booking.id!==bookingId)throw Error('Authoritative booking unavailable');
 const message=prepareConfirmedGuestEmail(booking);
 if(env.BOOKING_SES_SIMULATOR_ENABLED==='true'){
  if(booking.synthetic!==true||booking.guestEmail!=='test@example.invalid')throw Error('SES simulator requires synthetic booking');
  message.to='success@simulator.amazonses.com';
 }
 // No recipient override, no browser-supplied payment assertion and no automatic retries.
 return send({db,table,transport,env,message});
}

export async function dispatchBookingLifecycleEmail({db,table,bookingId,type,transport,
 env=process.env,send=sendBookingEmailOnce}={}){
 if(!db?.send||!transport?.send||!TABLE.test(table??'')||!ID.test(bookingId??'')||
  env.BOOKING_ENVIRONMENT!=='staging'||env.BOOKING_LIFECYCLE_DISPATCH_ENABLED!=='true'||
  !['approval_payment','declined','cancelled','confirmed','refund_confirmed','hold_expired'].includes(type))throw Error('Staging lifecycle dispatch disabled');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(booking?.id!==bookingId||booking.source!=='direct')throw Error('Authoritative booking unavailable');
 const simulator=env.BOOKING_SES_SIMULATOR_ENABLED==='true';
 if(simulator&&(booking.synthetic!==true||booking.guestEmail!=='test@example.invalid'))throw Error('SES simulator requires synthetic booking');
 const recipient=simulator?'success@simulator.amazonses.com':booking.guestEmail;
 let message;
 if(type==='confirmed')message={...prepareConfirmedGuestEmail(booking),to:recipient};
 else{
  const {renderBookingLifecycleEmail}=await import('./booking-lifecycle-email-templates.mjs');
  if(!Array.isArray(booking.units)||!booking.units.length||booking.units.length>2||new Set(booking.units).size!==booking.units.length||
   booking.units.some(u=>!['geranium','honeysuckle'].includes(u)))throw Error('Invalid booking cottages');
  const cottage=booking.units.length===2?'Geranium and Honeysuckle':booking.units[0]==='geranium'?'Geranium':'Honeysuckle';
  let checkout;
  if(type==='approval_payment'){
   checkout=(await db.send(new GetCommand({TableName:table,Key:{PK:'BOOKING#'+bookingId,SK:'PAYMENT#CHECKOUT'},ConsistentRead:true}))).Item;
   if(!Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=Math.floor(Date.now()/1000))throw Error('Expired payment request');
  }
  message={...renderBookingLifecycleEmail({type,booking:{bookingId,cottage,checkIn:booking.start,checkOut:booking.end,status:booking.status,
   approvedAmountPence:Math.round(Number(booking.approvedAmountGBP)*100),refundStatus:booking.refundStatus,
   refundedAmountPence:booking.refundedAmountPence},checkout}),to:recipient};
 }
 return send({db,table,transport,env,message});
}
