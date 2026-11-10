// LB-07 operator-facing reconciliation inspection; read-only, never releases payment links.
import {readCreationClaim} from './sumup-creation-claim.mjs';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {checkoutReference} from './sumup-checkout-orchestrator.mjs';
export async function inspectCheckoutRecovery({db,table,bookingId,lookupProviderByReference}={}){
 if(!db?.send||!table?.toLowerCase().includes('staging')||
   typeof lookupProviderByReference!=='function')throw Error('Staging recovery inspection unavailable');
 const reference=checkoutReference(bookingId);
 const [claim,registered]=await Promise.all([
  readCreationClaim({db,table,bookingId}),
  readRegisteredCheckout({db,table,bookingId})
 ]);
 if(registered){
  if(registered.reference!==reference)return {state:'CONFLICT',reference,claimPresent:!!claim};
  return {state:'REGISTERED',reference,checkoutId:registered.checkoutId,
   claimPresent:!!claim};
 }
 if(!claim)return {state:'NOT_STARTED',reference};
 if(claim.reference!==reference)return {state:'CONFLICT',reference,claimPresent:true};
 // If the provider is unreachable, propagate failure; never infer "no payment".
 const remote=await lookupProviderByReference(reference);
 if(!Array.isArray(remote))throw Error('Authoritative provider lookup required');
 if(remote.length>1)return {state:'PROVIDER_CONFLICT',reference,remoteCount:remote.length};
 if(remote.length===0)return {state:'CLAIM_UNRESOLVED',reference,claimStatus:claim.status};
 const checkout=remote[0];
 if(checkout.reference!==reference||checkout.amountPence!==claim.amountPence||
   checkout.currency!=='GBP')return {state:'PROVIDER_CONFLICT',reference,remoteCount:1};
 return {state:'PROVIDER_FOUND_UNREGISTERED',reference,checkoutId:checkout.checkoutId,
  providerStatus:checkout.status,claimStatus:claim.status};
}
