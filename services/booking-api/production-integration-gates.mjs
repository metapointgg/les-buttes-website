import {GetParameterCommand} from '@aws-sdk/client-ssm';
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ORIGINS=new Set(['https://lesbuttes.com','https://www.lesbuttes.com']);
export function productionRequestGate(env=process.env){
 return env.BOOKING_ENVIRONMENT==='production'&&TABLE.test(env.BOOKINGS_TABLE??'')&&
  env.BOOKING_REQUESTS_ENABLED==='true'&&env.LIVE_BOOKINGS_APPROVED==='true';
}
export async function loadProductionTurnstileSecret({ssm,env=process.env}={}){
 if(!productionRequestGate(env)||!ssm?.send)throw Error('Production requests are not approved');
 const out=await ssm.send(new GetParameterCommand({Name:'/les-buttes/booking/production/turnstile/secret',WithDecryption:true}));
 const secret=out?.Parameter?.Value;
 if(typeof secret!=='string'||secret.length<20||/^[123]x0{20,}/.test(secret))throw Error('Production Turnstile secret missing or invalid');
 return secret;
}
export function productionEmailGate(env=process.env){
 return productionRequestGate(env)&&env.EMAILS_ENABLED==='true'&&env.LIVE_EMAILS_APPROVED==='true'&&
  env.BOOKING_SES_REGION==='us-east-1'&&env.BOOKING_SES_SIMULATOR_ENABLED!=='true'&&
  /^[^@\s]+@lesbuttes\.com$/i.test(env.BOOKING_SES_FROM??'');
}
export function allowedProductionOrigin(origin){return ORIGINS.has(origin);}
