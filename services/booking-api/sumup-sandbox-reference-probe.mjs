// LB-08 strictly read-only sandbox reference lookup, using an existing checkout.
// Does not create or pay a checkout, perform booking writes, or reveal API keys.
import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials} from './sumup-sandbox-runtime.mjs';
import {createSumUpClient} from './sumup-checkout-client.mjs';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function probeCheckoutReference({env=process.env,ssmFactory,
 clientFactory=createSumUpClient}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.LB08_READONLY_REFERENCE_PROBE!=='yes'||!ID.test(env.LB08_CHECKOUT_ID??''))
  throw Error('Explicit read-only staging checkout reference probe authorisation required');
 const ssm=ssmFactory?ssmFactory():new SSMClient({region:'eu-west-2'});
 try{
  const {apiKey,merchantCode}=await loadSandboxSumUpCredentials({ssm});
  const client=clientFactory({apiKey,merchantCode,enabled:true});
  const existing=await client.retrieveCheckout(env.LB08_CHECKOUT_ID);
  const reference=existing?.checkout_reference;
  if(existing?.id!==env.LB08_CHECKOUT_ID||
     existing.merchant_code!==merchantCode||existing.currency!=='GBP'||
     Number(existing.amount)!==1||typeof reference!=='string')
   throw Error('Original sandbox checkout does not match expected evidence');
  const matches=await client.inspectCheckoutReference(reference);
  const match=matches.find(x=>x.checkoutId===existing.id);
  if(matches.length!==1||!match||match.status!==existing.status||
     match.amountPence!==100||!match.referenceMatched||!match.merchantMatched)
   throw Error('Checkout reference lookup evidence mismatch');
  return {verified:true,environment:'staging',checkoutId:existing.id,
   reference,checkoutStatus:match.status,matchCount:matches.length,
   amountPence:100,currency:'GBP',merchantMatched:true,
   reusedExistingCheckout:true,noCheckoutCreated:true};
 }finally{ssm.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await probeCheckoutReference(),null,2)+'\n');}
 catch(e){process.stderr.write('LB-08 read-only reference probe failed: '+(e.name??'Error')+'\n');process.exitCode=1;}
}
