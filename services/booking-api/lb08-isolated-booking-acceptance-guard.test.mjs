import test from 'node:test';
import assert from 'node:assert/strict';
import {runIsolatedBookingAcceptance, ISOLATED_TABLE} from './lb08-isolated-booking-acceptance.mjs';

const valid = {
  BOOKING_ENVIRONMENT: 'staging',
  AWS_REGION: 'eu-west-2',
  BOOKINGS_TABLE: ISOLATED_TABLE,
  LB08_ISOLATED_BOOKING_ACCEPTANCE: 'yes'
};

for (const [name, override] of [
  ['production environment', {BOOKING_ENVIRONMENT:'production'}],
  ['wrong region', {AWS_REGION:'us-east-1'}],
  ['shared staging master', {BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'}],
  ['missing explicit authorisation', {LB08_ISOLATED_BOOKING_ACCEPTANCE:undefined}],
  ['incorrect authorisation', {LB08_ISOLATED_BOOKING_ACCEPTANCE:'true'}]
]) {
  test('LB-08 rejects '+name+' before constructing an AWS client', async () => {
    let constructed = false;
    const env = {...valid, ...override};
    await assert.rejects(
      runIsolatedBookingAcceptance({
        env,
        clientFactory: () => { constructed = true; throw Error('AWS client must not be constructed'); }
      }),
      /LB-08 isolated table and explicit operator authorisation required/
    );
    assert.equal(constructed, false);
  });
}

test('LB-08 accepts the exact isolated staging guard and proceeds to table verification', async () => {
  let constructed = false;
  await assert.rejects(
    runIsolatedBookingAcceptance({
      env: valid,
      clientFactory: () => {
        constructed = true;
        return {
          send: async () => { throw Error('Synthetic describe-table boundary reached'); },
          destroy: () => {}
        };
      }
    }),
    /Synthetic describe-table boundary reached/
  );
  assert.equal(constructed, true);
});
