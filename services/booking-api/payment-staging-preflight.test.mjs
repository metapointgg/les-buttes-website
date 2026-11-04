import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentStagingConfiguration} from './payment-staging-preflight.mjs';
const valid={
 BOOKING_ENVIRONMENT:'staging',
 BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-ABC123',
 PAYMENT_RECONCILIATION_ENABLED:'false',
 PAYMENT_NOTIFICATIONS_ENABLED:'false',
 SUMUP_MERCHANT_CODE:'ABCDEF12',
 SUMUP_API_KEY:'sup_sk_test_example-do-not-use',
 PAYMENT_TRIGGER_HMAC_SECRET:'synthetic-only-32-character-secret-value'
};
test('LB-08 preflight accepts isolated, disabled sandbox-only configuration',()=>{
 const result=validatePaymentStagingConfiguration(valid);
 assert.equal(result.ready,true);assert.deepEqual(result.failures,[]);
});
test('LB-08 preflight rejects production resources, enabled payments and live keys',()=>{
 for(const change of [
  {BOOKING_ENVIRONMENT:'production'},
  {BOOKINGS_TABLE:'les-buttes-booking-production-BookingTable-ABC123'},
  {PAYMENT_RECONCILIATION_ENABLED:'true'},
  {PAYMENT_NOTIFICATIONS_ENABLED:'true'},
  {SUMUP_API_KEY:'sup_sk_live_example'},
  {PAYMENT_TRIGGER_HMAC_SECRET:'short'},
  {SUMUP_MERCHANT_CODE:''}
 ]){
  const result=validatePaymentStagingConfiguration({...valid,...change});
  assert.equal(result.ready,false);
  assert.ok(result.failures.length);
  assert.equal(JSON.stringify(result).includes('sup_sk_live_example'),false);
 }
});
test('LB-08 preflight defaults fail closed when environment is absent',()=>{
 assert.equal(validatePaymentStagingConfiguration({}).ready,false);
});
