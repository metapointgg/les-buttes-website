// Production SumUp credential and merchant boundary. This module performs no
// checkout or refund and remains unavailable until both release gates are set.
import {GetParameterCommand} from '@aws-sdk/client-ssm';
import {createSumUpClient} from './sumup-checkout-client.mjs';
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const PATHS=Object.freeze({key:'/les-buttes/booking/production/sumup/api-key',merchant:'/les-buttes/booking/production/sumup/merchant-code'});
const APPROVED_LIVE_MERCHANT='M9BE4KMN';
const KNOWN_SANDBOX_MERCHANT='MGV5J9QV';
function verifiedMerchantFacts(merchant,configuredMerchant){
 const merchantCode=merchant?.merchant_code;
 const merchantMatched=configuredMerchant===APPROVED_LIVE_MERCHANT&&merchantCode===APPROVED_LIVE_MERCHANT&&
  configuredMerchant!==KNOWN_SANDBOX_MERCHANT&&merchantCode!==KNOWN_SANDBOX_MERCHANT;
 const sandboxReported=typeof merchant?.sandbox==='boolean';
 const sandboxCompatible=!sandboxReported||merchant.sandbox===false;
 const currency=typeof merchant?.default_currency==='string'?merchant.default_currency:
  (typeof merchant?.currency==='string'?merchant.currency:null);
 const live=merchantMatched&&sandboxCompatible;
 return {verified:live&&currency==='GBP',merchantMatched,live,sandboxReported,currency,
  verificationStrategy:sandboxReported?'approved-live-code-and-provider-flag':'approved-live-code'};
}
export function productionPaymentsEnabled(env=process.env){
 return env.BOOKING_ENVIRONMENT==='production'&&env.AWS_REGION==='eu-west-2'&&env.PAYMENTS_ENABLED==='true'&&env.LIVE_PAYMENTS_APPROVED==='true'&&TABLE.test(env.BOOKINGS_TABLE??'');
}
export async function loadProductionSumUpCredentials({ssm,env=process.env}={}){
 if(!productionPaymentsEnabled(env)||!ssm?.send)throw Error('Production payments are not approved');
 const key=await ssm.send(new GetParameterCommand({Name:PATHS.key,WithDecryption:true}));
 const merchant=await ssm.send(new GetParameterCommand({Name:PATHS.merchant,WithDecryption:false}));
 const apiKey=key?.Parameter?.Value,merchantCode=merchant?.Parameter?.Value;
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_'))throw Error('Production SumUp secret missing or invalid');
 if(merchantCode!==APPROVED_LIVE_MERCHANT||merchantCode===KNOWN_SANDBOX_MERCHANT)
  throw Error('Production SumUp merchant code missing or invalid');
 return {apiKey,merchantCode};
}
export async function createVerifiedProductionSumUpClient({ssm,env=process.env,fetchImpl=globalThis.fetch,clientFactory=createSumUpClient}={}){
 const {apiKey,merchantCode}=await loadProductionSumUpCredentials({ssm,env});
 if(typeof fetchImpl!=='function')throw Error('Fetch client missing');
 const response=await fetchImpl('https://api.sumup.com/v1/merchants/'+encodeURIComponent(merchantCode),{method:'GET',headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'}});
 if(!response.ok)throw Error('SumUp API request failed: '+response.status);
 const merchant=await response.json();
 if(!verifiedMerchantFacts(merchant,merchantCode).verified)
  throw Error('Live SumUp merchant verification required (GBP)');
 const client=clientFactory({apiKey,merchantCode,fetchImpl,enabled:true,providerEnvironment:'live'});
 Object.defineProperty(client,'merchantCode',{value:merchantCode,enumerable:false,writable:false});
 return client;
}

export async function verifyProductionSumUpMerchant({ssm,env=process.env,fetchImpl=globalThis.fetch}={}){
 if(env.BOOKING_ENVIRONMENT!=='production'||env.AWS_REGION!=='eu-west-2'||
  env.PRODUCTION_PROVIDER_VERIFICATION_ENABLED!=='true'||!ssm?.send||typeof fetchImpl!=='function')
  throw Error('Production provider verification disabled');
 const key=await ssm.send(new GetParameterCommand({Name:PATHS.key,WithDecryption:true}));
 const merchantParam=await ssm.send(new GetParameterCommand({Name:PATHS.merchant,WithDecryption:false}));
 const apiKey=key?.Parameter?.Value,merchantCode=merchantParam?.Parameter?.Value;
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_')||
  merchantCode!==APPROVED_LIVE_MERCHANT||merchantCode===KNOWN_SANDBOX_MERCHANT)throw Error('Production credentials invalid');
 const response=await fetchImpl('https://api.sumup.com/v1/merchants/'+encodeURIComponent(merchantCode),
  {method:'GET',headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('SumUp merchant verification failed: '+response.status);
 const merchant=await response.json();
 return verifiedMerchantFacts(merchant,merchantCode);
}
