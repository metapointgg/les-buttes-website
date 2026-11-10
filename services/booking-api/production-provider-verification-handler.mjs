import {SSMClient} from '@aws-sdk/client-ssm';
import {verifyProductionSumUpMerchant} from './sumup-production-runtime.mjs';

export async function handler(){
 const ssm=new SSMClient({region:'eu-west-2'});
 try{return await verifyProductionSumUpMerchant({ssm,env:process.env});}
 catch(error){console.error('PRODUCTION_PROVIDER_VERIFICATION_FAILED',error?.name??'Error');throw error;}
 finally{ssm.destroy?.();}
}
