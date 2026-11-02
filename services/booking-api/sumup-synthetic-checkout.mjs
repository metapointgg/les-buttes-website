// LB-08 manually invoked synthetic checkout creation. No booking-master writes.
// Disabled unless the operator explicitly opts in; never run automatically in CI.
import {SSMClient} from '@aws-sdk/client-ssm';
import {randomUUID} from 'node:crypto';
import {loadSandboxSumUpCredentials} from './sumup-sandbox-runtime.mjs';
import {createSumUpClient} from './sumup-checkout-client.mjs';
export async function runSyntheticCheckout({env=process.env,ssmFactory,clientFactory=createSumUpClient}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.LB08_CREATE_SYNTHETIC_CHECKOUT!=='yes')
  throw Error('Explicit synthetic sandbox checkout authorisation required');
 const ssm=ssmFactory?ssmFactory():new SSMClient({region:'eu-west-2'});
 try {
  const {apiKey,merchantCode}=await loadSandboxSumUpCredentials({ssm,region:'eu-west-2'});
  const client=clientFactory({apiKey,merchantCode,enabled:true});
  const checkout=await client.createCheckout({
   reference:'lb08_'+randomUUID().replaceAll('-','').slice(0,24),
   amountPence:100,
   description:'Les Buttes synthetic staging checkout - not a guest booking'
  });
  return {created:true,environment:'staging',amountPence:100,currency:'GBP',
   checkoutId:checkout.checkoutId,status:checkout.status,
   hostedCheckoutUrl:checkout.hostedCheckoutUrl,
   note:'Synthetic checkout only; do not pay or treat as a guest reservation'};
 } finally {ssm.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const result=await runSyntheticCheckout();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch{
  process.stderr.write('LB-08 synthetic checkout failed; inspect safe probe and sandbox API contract. No secret details printed.\n');
  process.exitCode=1;
 }
}
