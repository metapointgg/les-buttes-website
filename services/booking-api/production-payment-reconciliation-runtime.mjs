import {SSMClient} from '@aws-sdk/client-ssm';
import {createVerifiedProductionSumUpClient,productionPaymentsEnabled} from './sumup-production-runtime.mjs';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function productionReconciliationEnabled(env=process.env){
 return productionPaymentsEnabled(env)&&env.MANAGEMENT_WRITES_ENABLED==='true'&&
  env.MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED==='true'&&env.LIVE_BOOKINGS_APPROVED==='true';
}
export async function reconcileOwnerLivePayment({db,bookingId,identity,env=process.env,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),clientFactory=createVerifiedProductionSumUpClient,
 reconcile=reconcileVerifiedPayment}={}){
 if(!productionReconciliationEnabled(env)||!db?.send||!ID.test(bookingId??'')||
  identity?.role!=='owner'||typeof identity.subject!=='string'||!identity.subject.trim())
  throw Error('Production payment reconciliation disabled');
 const ssm=ssmFactory();
 try{
  const sumup=await clientFactory({ssm,env});
  const result=await reconcile({db,table:env.BOOKINGS_TABLE,bookingId,
   fetchCheckout:id=>sumup.retrieveCheckout(id),merchantCode:sumup.merchantCode});
  if(!['CONFIRMED','ALREADY_CONFIRMED'].includes(result?.status)||result.bookingId!==bookingId)
   throw Error('Payment confirmation not verified');
  return result;
 }finally{ssm.destroy?.();}
}
