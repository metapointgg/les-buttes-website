import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {verifyProductionSumUpMerchant} from './sumup-production-runtime.mjs';

export async function handler(event={}){
 const ssm=new SSMClient({region:'eu-west-2'});
 try{
  // Temporary private Lambda Invoke-only diagnostic. No API Gateway route,
  // booking writes, checkout creation or provider POST are present.
  if(event?.diagnostic==='refund-evidence-20261113'){
   if(process.env.BOOKING_ENVIRONMENT!=='production'||
      process.env.PRODUCTION_PROVIDER_VERIFICATION_ENABLED!=='true')
    throw Error('Diagnostic disabled');
   const merchant='M9BE4KMN';
   const key=(await ssm.send(new GetParameterCommand({
    Name:'/les-buttes/booking/production/sumup/api-key',WithDecryption:true
   }))).Parameter?.Value;
   const configured=(await ssm.send(new GetParameterCommand({
    Name:'/les-buttes/booking/production/sumup/merchant-code'
   }))).Parameter?.Value;
   if(!key?.startsWith('sup_sk_')||configured!==merchant)
    throw Error('Approved merchant verification required');
   const id='961a3d32-f81a-4d8f-afb0-346bfdf3f686';
   const url='https://api.sumup.com/v2.1/merchants/'+merchant+'/transactions?id='+id;
   const response=await fetch(url,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
   if(!response.ok)return {httpStatus:response.status};
   const tx=await response.json();
   return {identityMatches:tx.id===id,merchantMatches:tx.merchant_code===merchant,
    currency:tx.currency,amount:tx.amount,status:tx.status,simpleStatus:tx.simple_status,
    refundedAmount:tx.refunded_amount,
    transactionEvents:tx.transaction_events?.map(x=>({type:x.event_type,status:x.status,amount:x.amount})),
    events:tx.events?.map(x=>({type:x.type,status:x.status,amount:x.amount}))};
  }
  return await verifyProductionSumUpMerchant({ssm,env:process.env});
 }catch(error){console.error('PRODUCTION_PROVIDER_VERIFICATION_FAILED',error?.name??'Error');throw error;}
 finally{ssm.destroy?.();}
}
