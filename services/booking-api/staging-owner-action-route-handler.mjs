// Dedicated entrypoint for canonical management owner decisions, staging only.
// API Gateway must independently verify the Cognito JWT before invocation.
import {handler as adminHandler} from './booking-admin-http.mjs';
const ROUTE='POST /admin/bookings/{bookingId}/actions/{action}';
const PATH=/^\/admin\/bookings\/[0-9a-f-]{36}\/actions\/(approve|decline|cancel)$/i;
const deny=(statusCode,error)=>({statusCode,
 headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 body:JSON.stringify({error})});
export async function handler(event){
 if(event?.requestContext?.http?.method!=='POST'||!PATH.test(event?.rawPath??''))
  return deny(404,'Not found');
 if(event?.requestContext?.routeKey!==ROUTE||
    !event?.requestContext?.authorizer?.jwt?.claims)
  return deny(403,'Forbidden');
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||
    !/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(process.env.BOOKINGS_TABLE??''))
  return deny(503,'Management writes disabled');
 return adminHandler(event);
}
