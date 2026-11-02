// LB-08 staging-only runtime retrieval and read-only SumUp connectivity.
// No checkout creation, booking write, HTTP handler, or secret logging.
import {GetParameterCommand} from '@aws-sdk/client-ssm';
const PATHS=Object.freeze({
 key:'/les-buttes/staging/sumup/api-key',
 merchant:'/les-buttes/staging/sumup/merchant-code'
});
export async function loadSandboxSumUpCredentials({ssm,region='eu-west-2'}={}){
 if(region!=='eu-west-2'||!ssm?.send)throw Error('Staging credential retrieval unavailable');
 const key=await ssm.send(new GetParameterCommand({Name:PATHS.key,WithDecryption:true}));
 const merchant=await ssm.send(new GetParameterCommand({Name:PATHS.merchant,WithDecryption:false}));
 const apiKey=key?.Parameter?.Value,merchantCode=merchant?.Parameter?.Value;
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_'))
  throw Error('Sandbox secret API key missing or unexpected format');
 if(typeof merchantCode!=='string'||!/^[A-Z0-9]{6,20}$/.test(merchantCode))
  throw Error('Sandbox merchant code missing or unexpected format');
 return {apiKey,merchantCode};
}
export async function checkSandboxSumUpConnectivity({ssm,region='eu-west-2',
 fetchImpl=globalThis.fetch}={}){
 const {apiKey,merchantCode}=await loadSandboxSumUpCredentials({ssm,region});
 // Never infer sandbox status from the API key prefix. Read merchant metadata
 // directly before allowing any payment-capable integration to be used.
 if(typeof fetchImpl!=='function')throw Error('Fetch client missing');
 const response=await fetchImpl('https://api.sumup.com/v1/merchants/'+encodeURIComponent(merchantCode),{
  method:'GET',headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'}});
 if(!response.ok)throw Error('SumUp API request failed: '+response.status);
 const merchant=await response.json();
 if(!merchant||merchant.merchant_code!==merchantCode)
  throw Error('Sandbox merchant identity mismatch');
 if(merchant.sandbox!==true)throw Error('SumUp merchant is not confirmed as sandbox');
 return {connected:true,environment:'staging',region,merchantMatched:true,
  sandboxVerified:true,note:'Read-only merchant sandbox identity verified; payment acceptance not tested'};
}
