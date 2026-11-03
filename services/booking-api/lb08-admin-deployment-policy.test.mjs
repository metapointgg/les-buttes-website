import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateOwnerPaymentDeployment} from './lb08-admin-deployment-policy.mjs';
const issuer='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa';
const clientId='2mjmimjh7oc8h00d4nngrc1akj';
const routeKey='POST /admin/bookings/{bookingId}/checkout/register';
const lambda={runtime:'nodejs22.x',handler:'booking-admin-http.handler',
 integrationTarget:'integrations/dedicated',issuer,clientId,
 bookingEnvironment:'staging',checkoutEnabled:false};
const args={apiRoutes:[{routeKey,authorizationType:'JWT',
 authorizerId:'jwt-id',integrationTarget:'integrations/dedicated'}],
 lambda,expectedIssuer:issuer,expectedAudience:clientId};
test('LB-08 deployment only eligible with dedicated Node owner JWT route, disabled checkout',()=>{
 assert.deepEqual(evaluateOwnerPaymentDeployment(args),
  {readyForDisabledDeployment:true,failures:[]});
});
test('LB-08 rejects existing public booking gateway and Python management Lambda',()=>{
 const publicBooking=evaluateOwnerPaymentDeployment({
  ...args,apiRoutes:[{routeKey:'ANY /{proxy+}',authorizationType:'NONE',
   integrationTarget:'integrations/tosyrub'}],
  lambda:{...lambda,runtime:'python3.13',handler:'index.handler'}});
 assert.equal(publicBooking.readyForDisabledDeployment,false);
 assert.ok(publicBooking.failures.some(x=>x.includes('Dedicated Node')));
 assert.ok(publicBooking.failures.some(x=>x.includes('route missing')));
});
test('LB-08 rejects unprotected checkout, wrong authorizer, enabled payment or production',()=>{
 for(const patch of [
  {apiRoutes:[{routeKey,authorizationType:'NONE',
   integrationTarget:'integrations/dedicated'}]},
  {apiRoutes:[{routeKey,authorizationType:'JWT',authorizerId:'jwt',
   integrationTarget:'integrations/public'}]},
  {lambda:{...lambda,checkoutEnabled:true}},
  {lambda:{...lambda,bookingEnvironment:'production'}},
  {lambda:{...lambda,clientId:'another-client'}}
 ]){
  const outcome=evaluateOwnerPaymentDeployment({...args,...patch});
  assert.equal(outcome.readyForDisabledDeployment,false);
  assert.ok(outcome.failures.length>0);
 }
});
