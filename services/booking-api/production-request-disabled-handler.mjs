// Deliberately deployed production boundary: there is no database client and the
// execution role has no booking, payment, SES or refund permission.
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
export async function handler(event){
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const respond=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
 if(process.env.BOOKING_ENVIRONMENT!=='production'||
    !TABLE.test(process.env.BOOKINGS_TABLE??'')||process.env.BOOKING_REQUESTS_ENABLED!=='false')
  return respond(503,{error:'Production booking boundary unavailable'});
 if((event?.requestContext?.http?.method??event?.httpMethod)!=='POST'||
    (event?.rawPath??event?.path)!=='/request')return respond(404,{error:'Not found'});
 return respond(503,{error:'Direct booking requests are not open yet'});
}
