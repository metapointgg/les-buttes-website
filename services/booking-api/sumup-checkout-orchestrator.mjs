// LB-07: fail-closed orchestration. Provider reconciliation must precede retry.
import {createHash} from 'node:crypto';
import {readRegisteredCheckout,registerCheckout,reconcileCheckoutRegistration} from './sumup-checkout-store.mjs';
const UUID=/^[0-9a-f-]{36}$/i;
export const checkoutReference=bookingId=>{
 if(!UUID.test(bookingId??''))throw Error('Invalid booking ID');
 return 'lb-'+createHash('sha256').update(bookingId.toLowerCase()).digest('hex').slice(0,32);
};
export async function createAndRegisterCheckout({db,table,bookingId,amountPence,sumup,
  lookupProviderByReference,nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||!table?.toLowerCase().includes('staging')||!sumup?.createCheckout||
   typeof lookupProviderByReference!=='function')throw Error('Staging checkout orchestration unavailable');
 if(!Number.isSafeInteger(amountPence)||amountPence<1)throw Error('Invalid checkout amount');
 const reference=checkoutReference(bookingId);
 const existing=await readRegisteredCheckout({db,table,bookingId});
 if(existing){
  if(existing.reference!==reference||existing.amountPence!==amountPence||existing.currency!=='GBP')
   throw Error('Conflicting registered checkout');
  return {status:'REGISTERED',record:existing};
 }
 // SumUp creation is external to DynamoDB. Before any creation, query the
 // provider by deterministic reference. If the query fails, do not create.
 const remote=await lookupProviderByReference(reference);
 if(remote&&remote.length>1)throw Error('Multiple provider checkouts require manual reconciliation');
 let checkout;
 if(remote?.length===1){
  checkout=remote[0];
  if(checkout.status!=='PENDING'||checkout.reference!==reference||
     checkout.amountPence!==amountPence||checkout.currency!=='GBP')
   throw Error('Provider checkout mismatch; manual reconciliation required');
 }else if(Array.isArray(remote)&&remote.length===0){
  // Never blindly retry after a timeout. A later call must query the provider again.
  checkout=await sumup.createCheckout({reference,amountPence});
 }else{
  throw Error('Provider lookup must return an authoritative list');
 }
 try{
  const record=await registerCheckout({db,table,bookingId,checkout,reference,nowEpoch});
  return {status:'REGISTERED',record};
 }catch(e){
  const result=await reconcileCheckoutRegistration({db,table,bookingId,checkout,reference});
  if(result.status==='REGISTERED')return result;
  if(result.status==='CONFLICT')throw Error('Conflicting registered checkout');
  // Checkout exists remotely but has not been registered. Never send its URL.
  throw Error('Provider checkout requires reconciliation before payment link can be shared',{cause:e});
 }
}
