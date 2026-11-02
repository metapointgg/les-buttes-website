// LB-08 staging-only runtime retrieval and read-only SumUp connectivity.
// No checkout creation, booking write, HTTP handler, or secret logging.
import {GetParameterCommand} from '@aws-sdk/client-ssm';
import {createSumUpClient} from './sumup-checkout-client.mjs';
const PATHS=Object.freeze({
 key:'/les-buttes/staging/sumup/api-key',
 merchant:'/les-buttes/staging/sumup/merchant-code'
});
export async function loadSandboxSumUpCredentials({ssm,region='eu-west-2'}={}){
 if(region!=='eu-west-2'||!ssm?.send)throw Error('Staging credential retrieval unavailable');
 const key=await ssm.send(new GetParameterCommand({Name:PATHS.key,WithDecryption:true}));
 const merchant=await ssm.send(new GetParameterCommand({Name:PATHS.merchant,WithDecryption:false}));
 const apiKey=key?.Parameter?.Value,merchantCode=merchant?.Parameter?.Value;
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_test_'))
  throw Error('Sandbox secret API key missing or unexpected format');
 if(typeof merchantCode!=='string'||!/^[A-Z0-9]{6,20}$/.test(merchantCode))
  throw Error('Sandbox merchant code missing or unexpected format');
 return {apiKey,merchantCode};
}
export async function checkSandboxSumUpConnectivity({ssm,region='eu-west-2',
 fetchImpl=globalThis.fetch}={}){
 const {apiKey,merchantCode}=await loadSandboxSumUpCredentials({ssm,region});
 // Use only provider GET endpoints. Never create a checkout or process a charge.
 const client=createSumUpClient({apiKey,merchantCode,fetchImpl,enabled:true});
 const profile=await client.retrieveMerchantProfile();
 if(!profile||typeof profile!=='object')throw Error('SumUp profile response invalid');
 // Avoid returning or logging the profile: it may include merchant contact details.
 const matches=profile.merchant_code===merchantCode||
   profile.merchant?.merchant_code===merchantCode;
 if(!matches)throw Error('Sandbox merchant identity mismatch');
 return {connected:true,environment:'staging',region,merchantMatched:true,
  note:'Authenticated read-only SumUp API request passed; hosted payment and GBP checkout not tested'};
}
