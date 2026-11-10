// Authoritative request notifications, using the existing durable email outbox.
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
const cottages={geranium:'Geranium',honeysuckle:'Honeysuckle'};
export function prepareRequestedBookingEmails(booking,{ownerEmail}={}){
 if(booking?.source!=='direct'||booking.status!=='REQUESTED'||booking.reservationStatus!=='PENDING_REVIEW'||
  !Array.isArray(booking.units)||booking.units.length<1||booking.units.length>2||
  new Set(booking.units).size!==booking.units.length||booking.units.some(u=>!Object.hasOwn(cottages,u)))
  throw Error('Authoritative requested booking required');
 const valid=email=>typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 if(!valid(booking.guestEmail)||!valid(ownerEmail))throw Error('Guest and configured owner recipients required');
 const state={bookingId:booking.id,cottage:booking.units.length===2?'Geranium and Honeysuckle':cottages[booking.units[0]],
  checkIn:booking.start,checkOut:booking.end,status:booking.status};
 return ['requested','owner_request'].map(type=>({...renderBookingLifecycleEmail({type,booking:state}),
  to:type==='requested'?booking.guestEmail:ownerEmail}));
}
