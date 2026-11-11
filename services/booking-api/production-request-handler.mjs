import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {controlledTestRequest,matchesControlledAccess} from './controlled-production-test.mjs';
import {loadProductionTurnstileSecret,productionEmailGate,productionRequestGate} from './production-integration-gates.mjs';
import {handler as bookingHandler} from './index.mjs';

const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 body:JSON.stringify({error})});
let secret;
let testAccess;
const ACCESS_PATH='/les-buttes/booking/production/test/one-time-access';

export async function handler(event){
 if(!productionRequestGate(process.env)||!productionEmailGate(process.env))
  return reply(503,'Direct booking requests are not open yet');
 if(!secret){
  const ssm=new SSMClient({region:'eu-west-2'});
  try{secret=await loadProductionTurnstileSecret({ssm,env:process.env});}
  catch(error){console.error('PRODUCTION_TURNSTILE_CONFIGURATION_FAILED',error?.name??'Error');return reply(503,'Service not configured');}
  finally{ssm.destroy?.();}
 }
 process.env.TURNSTILE_SECRET=secret;
 if(process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true'){
  const method=event?.requestContext?.http?.method??event?.httpMethod;
  if(method!=='POST'||!['/request','/requests'].includes(event?.rawPath))
   return reply(404,'Not found');
  if(typeof event.body!=='string'||event.body.length>10000||event.isBase64Encoded)
   return reply(400,'Invalid request');
  let input;
  try{input=JSON.parse(event.body);}catch{return reply(400,'Invalid request');}
  if(!controlledTestRequest(input))return reply(403,'Controlled production test only');
  if(!testAccess){
   const client=new SSMClient({region:'eu-west-2'});
   try{
    const result=await client.send(new GetParameterCommand({Name:ACCESS_PATH,WithDecryption:true}));
    testAccess=result.Parameter?.Value;
   }catch{
    console.error('CONTROLLED_TEST_ACCESS_UNAVAILABLE');
    return reply(503,'Test access unavailable');
   }finally{client.destroy?.();}
  }
  if(!matchesControlledAccess(input.testAccessCode,testAccess))
   return reply(403,'Controlled production test access required');
  delete input.testAccessCode; // Never persist the bearer token in a booking.
  event={...event,body:JSON.stringify(input)};
 }
 return bookingHandler(event);
}
