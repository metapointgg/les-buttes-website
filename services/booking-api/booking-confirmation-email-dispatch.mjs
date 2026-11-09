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
 // No recipient override, no browser-supplied payment assertion and no automatic retries.
 return send({db,table,transport,env,message});
}
