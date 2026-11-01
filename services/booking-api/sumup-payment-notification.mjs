// LB-08: internal-only notification dispatcher. Not an authenticated public webhook route.
// The notification is merely a wake-up signal; no status or amount from it is trusted.
import {verifyInternalPaymentTrigger} from './sumup-payment-trigger-auth.mjs';
const BOOKING_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function processPaymentNotification({notification,reconcile,enabled=false}={}){
 if(!enabled)throw Error('Payment notifications disabled');
 if(typeof reconcile!=='function')throw Error('Payment reconciler missing');
 if(!notification||typeof notification!=='object'||Array.isArray(notification)||
    !BOOKING_ID.test(notification.bookingId??''))throw Error('Invalid notification');
 // Reject caller assertions rather than risk accidentally introducing trusted fields.
 const keys=Object.keys(notification);
 if(keys.length!==1||keys[0]!=='bookingId')
  throw Error('Notification may supply only a booking reference');
 return reconcile({bookingId:notification.bookingId});
}

export async function processSignedInternalPaymentTrigger({body,signature,secret,reconcile,
 nowEpoch=Math.floor(Date.now()/1000),enabled=false}={}){
 if(!enabled)throw Error('Payment notifications disabled');
 const auth=verifyInternalPaymentTrigger({body,signature,secret,nowEpoch});
 if(!auth.ok)throw Error('Unauthorised payment trigger');
 return processPaymentNotification({notification:{bookingId:auth.bookingId},reconcile,enabled});
}
