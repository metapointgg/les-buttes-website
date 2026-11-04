// LB-08 pure deployment gate. A public booking API must never host owner checkout writes.
export function evaluateOwnerPaymentDeployment({apiRoutes,lambda,expectedIssuer,expectedAudience,
 targetRoute='POST /admin/bookings/{bookingId}/checkout/register'}={}){
 const failures=[];
 if(!Array.isArray(apiRoutes))failures.push('API Gateway routes not inspected');
 if(!lambda||lambda.runtime!=='nodejs22.x'||lambda.handler!=='booking-admin-http.handler')
  failures.push('Dedicated Node management handler missing');
 const route=Array.isArray(apiRoutes)?apiRoutes.find(x=>x.routeKey===targetRoute):null;
 if(!route)failures.push('Explicit owner checkout route missing');
 else{
  if(route.authorizationType!=='JWT'||!route.authorizerId)
   failures.push('Checkout route lacks JWT authorizer');
  if(!route.integrationTarget||route.integrationTarget!==lambda?.integrationTarget)
   failures.push('Checkout route does not target dedicated management Lambda');
 }
 if(!expectedIssuer||!expectedAudience||
    lambda?.issuer!==expectedIssuer||lambda?.clientId!==expectedAudience)
  failures.push('Management Lambda Cognito issuer and client ID not verified');
 if(lambda?.bookingEnvironment!=='staging')
  failures.push('Management Lambda is not staging');
 if(lambda?.checkoutEnabled===true)
  failures.push('Checkout creation must remain disabled during deployment preflight');
 return {readyForDisabledDeployment:failures.length===0,failures};
}
