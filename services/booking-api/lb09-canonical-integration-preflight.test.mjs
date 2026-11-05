import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCanonicalPaymentIntegration} from './lb09-canonical-integration-preflight.mjs';
const base={stack:{StackStatus:'UPDATE_COMPLETE'},apiId:'i2irz87c82',
 bookingTable:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',
 lambdaConfig:{Runtime:'python3.13',Handler:'app.handler',Environment:{Variables:{}}},
 routes:[{RouteKey:'ANY /{proxy+}',AuthorizationType:'JWT',Target:'integrations/existing'},
 {RouteKey:'POST /admin/bookings/{bookingId}/payment/reconcile',
  AuthorizationType:'JWT',Target:'integrations/restricted'}]};
test('LB-09 detects missing canonical staging payment route',()=>{
 const result=inspectCanonicalPaymentIntegration({...base,routes:base.routes.slice(0,1)});
 assert.equal(result.ready,false);
 assert.match(result.failures.join(' '),/Dedicated payment route not installed/);
});
test('LB-09 accepts dedicated JWT route only when canonical Python owner service is preserved',()=>{
 assert.equal(inspectCanonicalPaymentIntegration(base).ready,true);
 for(const change of [
  {apiId:'other'},{lambdaConfig:{...base.lambdaConfig,Runtime:'nodejs22.x'}},
  {routes:[base.routes[0],{...base.routes[1],AuthorizationType:'NONE'}]},
  {bookingTable:'les-buttes-booking-production-BookingTable-XYZ'},
  {lambdaConfig:{...base.lambdaConfig,Environment:{Variables:{BOOKING_EMAILS_ENABLED:'true'}}}}
 ])assert.equal(inspectCanonicalPaymentIntegration({...base,...change}).ready,false);
});
