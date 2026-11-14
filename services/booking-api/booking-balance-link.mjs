// Durable, booking-scoped capability for a guest-initiated payment session.
// A link is not a payment assertion: provider evidence is still mandatory.
import {timingSafeEqual} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function balancePaymentPageUrl({bookingId,token}={}){
 if(!UUID.test(bookingId??'')||!TOKEN.test(token??''))
  throw Error('Invalid balance payment capability');
 return 'https://lesbuttes.com/pay/#booking='+encodeURIComponent(bookingId)+
   '&access='+encodeURIComponent(token);
}
export function verifyBalancePaymentAccess({booking,bookingId,token}={}){
 if(!UUID.test(bookingId??'')||!TOKEN.test(token??'')||
    booking?.id!==bookingId||typeof booking.balanceAccessToken!=='string'||
    !TOKEN.test(booking.balanceAccessToken)||
    booking.source!=='direct'||booking.synthetic===true||
    booking.status!=='CONFIRMED'||booking.reservationStatus!=='CONFIRMED'||
    booking.paymentStatus!=='PARTIALLY_PAID'||
    !Number.isSafeInteger(booking.balanceDuePence)||booking.balanceDuePence<1)
  return false;
 const supplied=Buffer.from(token,'utf8');
 const expected=Buffer.from(booking.balanceAccessToken,'utf8');
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
