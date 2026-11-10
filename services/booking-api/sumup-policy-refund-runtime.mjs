import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials,checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';
import {executePolicyRefund} from './sumup-policy-refund.mjs';

export async function executeSandboxPolicyRefund({db,table,bookingId,env=process.env,
 fetchImpl=fetch,ssm=new SSMClient({region:'eu-west-2'}),execute=executePolicyRefund,
 verifyMerchant=checkSandboxSumUpConnectivity,loadCredentials=loadSandboxSumUpCredentials}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
   env.BOOKING_SANDBOX_POLICY_REFUND_ACCEPTANCE!=='true')
  throw Error('Sandbox policy refund acceptance disabled');
 try{
  const merchant=await verifyMerchant({ssm,region:'eu-west-2'});
  if(!merchant.sandboxVerified||!merchant.merchantMatched)throw Error('Sandbox merchant required');
  const {apiKey,merchantCode}=await loadCredentials({ssm,region:'eu-west-2'});
  const headers={Authorization:'Bearer '+apiKey,'Content-Type':'application/json'};
  const readProvider=async transactionId=>{
   const response=await fetchImpl('https://api.sumup.com/v2.1/merchants/'+encodeURIComponent(merchantCode)+'/transactions?id='+encodeURIComponent(transactionId),
    {headers,signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Provider transaction read failed: '+response.status);
   const item=await response.json();
   const events=Array.isArray(item.transaction_events)?item.transaction_events:item.events;
   if(item.id!==transactionId||item.merchant_code!==merchantCode||item.currency!=='GBP'||
     !Number.isFinite(item.amount)||!Array.isArray(events))throw Error('Provider transaction evidence mismatch');
   const refunds=events.filter(event=>(event.event_type??event.type)==='REFUND');
   if(refunds.some(event=>!Number.isFinite(event.amount)||event.amount<=0))throw Error('Invalid provider refund amount');
   return {transactionId,currency:'GBP',paidPence:Math.round(item.amount*100),
    refundedPence:refunds.filter(event=>['REFUNDED','SUCCESSFUL'].includes(event.status))
     .reduce((total,event)=>total+Math.round(event.amount*100),0),
    refundPending:refunds.some(event=>!['REFUNDED','SUCCESSFUL','FAILED'].includes(event.status))};
  };
  const requestProviderRefund=async({transactionId,amountPence,full})=>{
   // SumUp's current merchant-payment refund endpoint documents major units,
   // but its sandbox repeatedly interpreted partial amounts as minor units
   // (£402.50 became £4.02). Use the provider's established transaction
   // refund endpoint, whose official examples and SDKs use major units.
   const options={method:'POST',headers,signal:AbortSignal.timeout(12000)};
   if(!full)options.body=JSON.stringify({amount:amountPence/100});
   const response=await fetchImpl('https://api.sumup.com/v0.1/me/refund/'+encodeURIComponent(transactionId),options);
   if(!response.ok)throw Error('Provider refund rejected: '+response.status);
  };
  return execute({db,table,bookingId,readProvider,requestProviderRefund,enabled:true});
 }finally{ssm.destroy?.();}
}
