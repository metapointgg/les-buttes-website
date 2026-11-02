// LB-08 explicitly invoked read-only retrieval of one existing synthetic checkout.
import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials} from './sumup-sandbox-runtime.mjs';
import {createSumUpClient} from './sumup-checkout-client.mjs';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readSyntheticCheckout({env=process.env,ssmFactory,clientFactory=createSumUpClient}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.LB08_READ_SYNTHETIC_CHECKOUT!=='yes'||!ID.test(env.LB08_CHECKOUT_ID??''))
  throw Error('Explicit staging read-only checkout authorisation and ID required');
 const ssm=ssmFactory?ssmFactory():new SSMClient({region:'eu-west-2'});
 try{
  const {apiKey,merchantCode}=await loadSandboxSumUpCredentials({ssm});
  const client=clientFactory({apiKey,merchantCode,enabled:true});
  // Independent GET; no checkout creation, payment, or booking DB interaction.
  const checkout=await client.retrieveCheckout(env.LB08_CHECKOUT_ID);
  if(checkout?.id!==env.LB08_CHECKOUT_ID||checkout.merchant_code!==merchantCode||
     checkout.currency!=='GBP'||Number(checkout.amount)!==1)
   throw Error('Synthetic checkout evidence mismatch');
  const transactions=Array.isArray(checkout.transactions)?checkout.transactions:[];
  const evidence=transactions.map(tx=>({id:typeof tx.id==='string'?tx.id:null,
   status:typeof tx.status==='string'?tx.status:null,
   amountPence:Number.isFinite(Number(tx.amount))?Math.round(Number(tx.amount)*100):null,
   currency:typeof tx.currency==='string'?tx.currency:null,
   merchantMatched:tx.merchant_code===merchantCode,
   hasAmount:tx.amount!==undefined,hasMerchantCode:tx.merchant_code!==undefined}));
  return {retrieved:true,checkoutId:checkout.id,status:checkout.status,
   amountPence:100,currency:'GBP',merchantMatched:true,environment:'staging',
   transactionCount:transactions.length,transactions:evidence};
 }finally{ssm.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await readSyntheticCheckout(),null,2)+'\n');}
 catch{process.stderr.write('LB-08 checkout retrieval failed: inspect checkout status and merchant identity (no secrets printed).\n');process.exitCode=1;}
}
