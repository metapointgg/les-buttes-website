// Staging-only post-payment orchestration. A committed payment is never rolled back
// because SES fails; correspondence remains a separate durable outbox operation.
import {reconcileOwnerSandboxPayment} from './booking-payment-reconciliation-runtime.mjs';
import {dispatchConfirmedGuestEmail} from './booking-confirmation-email-dispatch.mjs';
export async function reconcilePaymentAndNotify({
 db,bookingId,identity,table,transport,env=process.env,
 reconcile=reconcileOwnerSandboxPayment,dispatch=dispatchConfirmedGuestEmail
}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||!db?.send||
    env.MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED!=='true')
  throw Error('Staging payment confirmation disabled');
 const confirmed=await reconcile({db,bookingId,identity,env});
 if(confirmed?.bookingId!==bookingId||
    !['CONFIRMED','ALREADY_CONFIRMED'].includes(confirmed.status))
  throw Error('Provider-verified confirmation required before correspondence');
 const base={bookingId,status:confirmed.status,guestNotificationSent:false};
 // Notification requires its own explicit gate. A disabled SES integration does
 // not prevent booking confirmation or misrepresent delivery as successful.
 if(env.BOOKING_CONFIRMATION_DISPATCH_ENABLED!=='true')
  return {...base,notificationStatus:'DISABLED'};
 try{
  const result=await dispatch({db,table:table??env.BOOKINGS_TABLE,bookingId,transport,env});
  return {...base,notificationStatus:result.status};
 }catch{
  // Outbox retains its claim after an ambiguous SES outcome. Never automatically
  // retry, never claim guest delivery, and never undo the payment confirmation.
  return {...base,notificationStatus:'RECONCILIATION_REQUIRED'};
 }
}
