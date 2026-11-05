// LB-09: pure, fail-closed inspection of the canonical management API integration.
// Read-only preflight; does not create routes, roles, Lambdas or change flags.
const STAGING_TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const ROUTE='POST /admin/bookings/{bookingId}/payment/reconcile';
export function inspectCanonicalPaymentIntegration({stack,apiId,routes=[],lambdaConfig,
 bookingTable,expectedApiId='i2irz87c82'}={}){
 const failures=[];
 if(stack?.StackStatus!=='UPDATE_COMPLETE')failures.push('Canonical stack not stable');
 if(apiId!==expectedApiId)failures.push('Unexpected canonical API');
 if(!STAGING_TABLE.test(bookingTable??''))failures.push('Staging booking table not pinned');
 if(lambdaConfig?.Runtime!=='python3.13'||lambdaConfig?.Handler!=='app.handler')
  failures.push('Canonical Python management handler changed');
 const catchAll=routes.find(x=>x.RouteKey==='ANY /{proxy+}');
 if(!catchAll||catchAll.AuthorizationType!=='JWT')
  failures.push('Canonical catch-all JWT protection missing');
 const paymentRoutes=routes.filter(x=>x.RouteKey===ROUTE);
 if(paymentRoutes.length!==1)failures.push('Dedicated payment route not installed');
 else if(paymentRoutes[0].AuthorizationType!=='JWT'||!paymentRoutes[0].Target)
  failures.push('Dedicated payment route lacks JWT or integration');
 const env=lambdaConfig?.Environment?.Variables??{};
 if(env.BOOKING_CONFIRMATION_DISPATCH_ENABLED==='true'||env.BOOKING_EMAILS_ENABLED==='true')
  failures.push('Canonical owner Lambda must not enable guest SES dispatch');
 return {ready:failures.length===0,failures,
  route:ROUTE,canonicalApiId:expectedApiId,readOnlyInspection:true};
}
