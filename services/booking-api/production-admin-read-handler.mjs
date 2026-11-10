// Cognito-protected, read-only production booking management integration.
// The API routes expose a distinct /admin/production prefix and the IAM role
// has no write, payment, email or configuration-publication permissions.
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {createAdminHandler,identityFromGateway} from './booking-admin-http.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 body:JSON.stringify({error})});
let deployed;

export async function handler(event){
 if(process.env.BOOKING_ENVIRONMENT!=='production'||!TABLE.test(process.env.BOOKINGS_TABLE??''))
  return reply(503,'Production booking management unavailable');
 const path=event?.rawPath??'';
 if(!path.startsWith('/admin/production/'))return reply(404,'Not found');
 if((event?.requestContext?.http?.method??event?.httpMethod)!=='GET')return reply(405,'Method not allowed');
 if(!deployed){
  const reader=createReadOnlyAdminReader({bookingIndex:'BookingRequestsIndex',
   authorise:async request=>identityFromGateway(request)});
  deployed=createAdminHandler({reader,writeEnabled:()=>false});
 }
 return deployed({...event,rawPath:path.replace('/admin/production/','/admin/')});
}
