import {SSMClient} from '@aws-sdk/client-ssm';
import {createVerifiedProductionSumUpClient,productionPaymentsEnabled} from './sumup-production-runtime.mjs';
import {registerApprovedBookingCheckout} from './booking-approved-checkout.mjs';

export function productionCheckoutEnabled(env=process.env){
 return productionPaymentsEnabled(env)&&env.MANAGEMENT_WRITES_ENABLED==='true'&&
  env.MANAGEMENT_CHECKOUT_ENABLED==='true'&&env.LIVE_BOOKINGS_APPROVED==='true';
}

export async function registerCheckoutWithLiveSumUp({db,bookingId,identity,env=process.env,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),clientFactory=createVerifiedProductionSumUpClient,
 register=registerApprovedBookingCheckout}={}){
 if(!productionCheckoutEnabled(env)||!db?.send||identity?.role!=='owner'||
  typeof identity.subject!=='string'||!identity.subject.trim())throw Error('Production checkout registration disabled');
 const ssm=ssmFactory();
 try{
  const sumup=await clientFactory({ssm,env});
  return register({db,table:env.BOOKINGS_TABLE,bookingId,identity,sumup,env});
 }finally{ssm.destroy?.();}
}
