import {SSMClient} from '@aws-sdk/client-ssm';
import {loadProductionTurnstileSecret,productionRequestGate} from './production-integration-gates.mjs';
import {handler as bookingHandler} from './index.mjs';

const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 body:JSON.stringify({error})});
let secret;

export async function handler(event){
 if(!productionRequestGate(process.env))return reply(503,'Direct booking requests are not open yet');
 if(!secret){
  const ssm=new SSMClient({region:'eu-west-2'});
  try{secret=await loadProductionTurnstileSecret({ssm,env:process.env});}
  catch(error){console.error('PRODUCTION_TURNSTILE_CONFIGURATION_FAILED',error?.name??'Error');return reply(503,'Service not configured');}
  finally{ssm.destroy?.();}
 }
 process.env.TURNSTILE_SECRET=secret;
 return bookingHandler(event);
}
