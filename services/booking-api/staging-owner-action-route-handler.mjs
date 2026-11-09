// Dedicated entrypoint for canonical management owner decisions, staging only.
// API Gateway must independently verify the Cognito JWT before invocation.
import {handler as adminHandler} from './booking-admin-http.mjs';
const ROUTES=new Set(['POST /admin/bookings/{bookingId}/actions/{action}',
 'POST /admin/config/{kind}/{unit}/{operation}']);
const PATHS=[/^\/admin\/bookings\/[0-9a-f-]{36}\/actions\/(approve|decline|cancel)$/i,
 /^\/admin\/config\/(pricing|stay-rules|cancellation|payments|business|arrival-departure|terms)\/(geranium|honeysuckle|all)\/(publish|rollback)$/];
const deny=(statusCode,error)=>({statusCode,
 headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
 body:JSON.stringify({error})});
export async function handler(event){
 if(event?.requestContext?.http?.method!=='POST'||!PATHS.some(path=>path.test(event?.rawPath??'')))
  return deny(404,'Not found');
 if(!ROUTES.has(event?.requestContext?.routeKey)||
    !event?.requestContext?.authorizer?.jwt?.claims)
  return deny(403,'Forbidden');
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||
    !/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(process.env.BOOKINGS_TABLE??''))
  return deny(503,'Management writes disabled');
 return adminHandler(event);
}
