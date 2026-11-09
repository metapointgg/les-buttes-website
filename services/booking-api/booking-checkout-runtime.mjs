// LB-08 staging-only checkout registration composition.
// This module owns the provider-credential boundary; callers cannot set amounts,
// merchant identifiers, or hosted checkout URLs.
import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials,checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';
import {createSumUpClient} from './sumup-checkout-client.mjs';
import {registerApprovedBookingCheckout} from './booking-approved-checkout.mjs';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
export function checkoutRuntimeEnabled(env=process.env){
 return env.BOOKING_ENVIRONMENT==='staging'&&env.AWS_REGION==='eu-west-2'&&
  env.MANAGEMENT_WRITES_ENABLED==='true'&&
  env.MANAGEMENT_CHECKOUT_ENABLED==='true'&&TABLE.test(env.BOOKINGS_TABLE??'');
}
export async function registerCheckoutWithSandbox({db,bookingId,identity,env=process.env,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 verifyMerchant=checkSandboxSumUpConnectivity,
 loadCredentials=loadSandboxSumUpCredentials,clientFactory=createSumUpClient,
 register=registerApprovedBookingCheckout}={}){
 // Fail before SSM, provider or DynamoDB calls when not explicitly enabled.
 if(!checkoutRuntimeEnabled(env)||!db?.send||identity?.role!=='owner'||
    typeof identity.subject!=='string'||!identity.subject.trim())
  throw Error('Staging sandbox checkout registration disabled');
 const ssm=ssmFactory();
 try{
  // Even valid-looking API keys may belong to a real merchant: verify the
  // authoritative sandbox flag *before* allowing any payment-capable POST.
  const checked=await verifyMerchant({ssm,region:'eu-west-2'});
  if(checked?.sandboxVerified!==true||checked.merchantMatched!==true)
   throw Error('Sandbox merchant verification required');
  const {apiKey,merchantCode}=await loadCredentials({ssm,region:'eu-west-2'});
  const sumup=clientFactory({apiKey,merchantCode,enabled:true});
  return await register({db,table:env.BOOKINGS_TABLE,bookingId,identity,sumup});
 }finally{ssm.destroy?.();}
}
