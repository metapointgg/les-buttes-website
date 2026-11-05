// LB-09 staging-only confirmed-booking dispatch. Not attached to public API routes.
// Reads authoritative state afresh; durable outbox prevents duplicate SES sends.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {prepareConfirmedGuestEmail} from './booking-confirmation-email-preparation.mjs';
import {sendBookingEmailOnce} from './booking-email-outbox.mjs';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
