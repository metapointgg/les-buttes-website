// Production SumUp credential and merchant boundary. This module performs no
// checkout or refund and remains unavailable until both release gates are set.
import {GetParameterCommand} from '@aws-sdk/client-ssm';
import {createSumUpClient} from './sumup-checkout-client.mjs';
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const PATHS=Object.freeze({key:'/les-buttes/booking/production/sumup/api-key',merchant:'/les-buttes/booking/production/sumup/merchant-code'});
export function productionPaymentsEnabled(env=process.env){
 return env.BOOKING_ENVIRONMENT==='production'&&env.AWS_REGION==='eu-west-2'&&env.PAYMENTS_ENABLED==='true'&&env.LIVE_PAYMENTS_APPROVED==='true'&&TABLE.test(env.BOOKINGS_TABLE??'');
}
export async function loadProductionSumUpCredentials({ssm,env=process.env}={}){
 if(!productionPaymentsEnabled(env)||!ssm?.send)throw Error('Production payments are not approved');
 const key=await ssm.send(new GetParameterCommand({Name:PATHS.key,WithDecryption:true}));
 const merchant=await ssm.send(new GetParameterCommand({Name:PATHS.merchant,WithDecryption:false}));
 const apiKey=key?.Parameter?.Value,merchantCode=merchant?.Parameter?.Value;
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_'))throw Error('Production SumUp secret missing or invalid');
 if(typeof merchantCode!=='string'||!/^[A-Z0-9]{6,20}$/.test(merchantCode))throw Error('Production SumUp merchant code missing or invalid');
 return {apiKey,merchantCode};
}
export async function createVerifiedProductionSumUpClient({ssm,env=process.env,fetchImpl=globalThis.fetch,clientFactory=createSumUpClient}={}){
 const {apiKey,merchantCode}=await loadProductionSumUpCredentials({ssm,env});
 if(typeof fetchImpl!=='function')throw Error('Fetch client missing');
 const response=await fetchImpl('https://api.sumup.com/v1/merchants/'+encodeURIComponent(merchantCode),{method:'GET',headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'}});
 if(!response.ok)throw Error('SumUp API request failed: '+response.status);
 const merchant=await response.json();
 if(merchant?.merchant_code!==merchantCode||merchant?.sandbox!==false)throw Error('Live SumUp merchant verification required');
 return clientFactory({apiKey,merchantCode,fetchImpl,enabled:true,providerEnvironment:'live'});
}
