// Prepare a confirmation email from an authoritative, provider-confirmed booking.
// Pure function: no SES send, no fallback recipient, no payment-state mutation.
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cottages=Object.freeze({geranium:'Geranium',honeysuckle:'Honeysuckle'});
export function prepareConfirmedGuestEmail(booking){
 if(!booking||!ID.test(booking.id??'')||booking.source!=='direct'||
    booking.status!=='CONFIRMED'||booking.reservationStatus!=='CONFIRMED'||
    typeof booking.paidAt!=='string'||!Number.isFinite(Date.parse(booking.paidAt))||
    typeof booking.paymentTransactionId!=='string'||booking.paymentTransactionId.length<6||
    typeof booking.guestEmail!=='string'||booking.guestEmail.length>254||
    !EMAIL.test(booking.guestEmail)||!Array.isArray(booking.units)||
    booking.units.length<1||booking.units.length>2||
    new Set(booking.units).size!==booking.units.length||
    booking.units.some(unit=>!Object.hasOwn(cottages,unit)))
  throw Error('Authoritative confirmed booking and guest recipient required');
 const cottage=booking.units.length===2?'Geranium and Honeysuckle':cottages[booking.units[0]];
 const rendered=renderBookingLifecycleEmail({type:'confirmed',booking:{
  bookingId:booking.id,cottage,checkIn:booking.start,checkOut:booking.end,
  status:'CONFIRMED',paymentVerified:true
 }});
 return {...rendered,to:booking.guestEmail};
}
