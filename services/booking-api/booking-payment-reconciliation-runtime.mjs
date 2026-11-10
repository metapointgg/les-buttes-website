// Owner-initiated staging-only reconciliation; never trust browser payment assertions.
// Payment confirmation is performed by the existing atomic DynamoDB reconciler.
import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials,checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';
import {createSumUpClient} from './sumup-checkout-client.mjs';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function paymentReconciliationEnabled(env=process.env){
 return env.BOOKING_ENVIRONMENT==='staging'&&env.AWS_REGION==='eu-west-2'&&
  env.MANAGEMENT_WRITES_ENABLED==='true'&&env.MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED==='true'&&
  TABLE.test(env.BOOKINGS_TABLE??'');
}
export async function reconcileOwnerSandboxPayment({db,bookingId,identity,env=process.env,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 verifyMerchant=checkSandboxSumUpConnectivity,
 loadCredentials=loadSandboxSumUpCredentials,clientFactory=createSumUpClient,
 reconcile=reconcileVerifiedPayment}={}){
 if(!paymentReconciliationEnabled(env)||!db?.send||!ID.test(bookingId??'')||
    identity?.role!=='owner'||typeof identity.subject!=='string'||!identity.subject.trim())
  throw Error('Staging payment reconciliation disabled');
 const ssm=ssmFactory();
 try{
  const verified=await verifyMerchant({ssm,region:'eu-west-2'});
  if(verified?.sandboxVerified!==true||verified.merchantMatched!==true)
   throw Error('Sandbox merchant verification required');
  const {apiKey,merchantCode}=await loadCredentials({ssm,region:'eu-west-2'});
  const sumup=clientFactory({apiKey,merchantCode,enabled:true});
  const result=await reconcile({db,table:env.BOOKINGS_TABLE,bookingId,
   fetchCheckout:id=>sumup.retrieveCheckout(id),merchantCode});
  if(!['CONFIRMED','ALREADY_CONFIRMED'].includes(result?.status)||result.bookingId!==bookingId)
   throw Error('Payment confirmation not verified');
  // Guest notification is a separate, auditable post-confirmation operation.
  return {bookingId,status:result.status,guestNotificationSent:false};
 }finally{ssm.destroy?.();}
}
