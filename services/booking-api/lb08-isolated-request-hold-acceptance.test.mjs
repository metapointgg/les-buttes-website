import test from 'node:test';
import assert from 'node:assert/strict';
import {runIsolatedRequestHoldAcceptance} from './lb08-isolated-request-hold-acceptance.mjs';
import {ISOLATED_TABLE} from './lb08-isolated-booking-acceptance.mjs';

const env = {
  BOOKING_ENVIRONMENT:'staging',
  AWS_REGION:'eu-west-2',
  BOOKINGS_TABLE:ISOLATED_TABLE,
  LB08_ISOLATED_BOOKING_ACCEPTANCE:'yes'
};

for (const [label, change] of [
  ['production environment', {BOOKING_ENVIRONMENT:'production'}],
  ['wrong AWS region', {AWS_REGION:'us-east-1'}],
  ['shared staging booking table', {BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'}],
  ['missing operator authorisation', {LB08_ISOLATED_BOOKING_ACCEPTANCE:undefined}],
  ['incorrect operator authorisation', {LB08_ISOLATED_BOOKING_ACCEPTANCE:'true'}]
]) {
  test('A08 refuses '+label+' before creating an AWS client', async () => {
    let created = false;
    await assert.rejects(
      runIsolatedRequestHoldAcceptance({
        env:{...env,...change},
        clientFactory:()=>{created=true;throw Error('Unexpected AWS client creation');}
      }),
      /LB-08 isolated table and explicit operator authorisation required/
    );
    assert.equal(created,false);
  });
}

test('A08 checks table identity before any transaction', async () => {
  const commands=[];
  const client={
    send:async command=>{
      commands.push(command.constructor.name);
      return {Table:{TableName:ISOLATED_TABLE,TableStatus:'ACTIVE',
        TableArn:'arn:aws:dynamodb:eu-west-2:000000000000:table/'+ISOLATED_TABLE}};
    },
    destroy:()=>{}
  };
  await assert.rejects(
    runIsolatedRequestHoldAcceptance({env,clientFactory:()=>client}),
    /Dedicated acceptance table identity not verified/
  );
  assert.deepEqual(commands,['DescribeTableCommand']);
});

test('A08 rejects invalid synthetic IDs without writing to DynamoDB', async () => {
  const commands=[];
  const client={send:async command=>{commands.push(command.constructor.name);},destroy:()=>{}};
  await assert.rejects(
    runIsolatedRequestHoldAcceptance({
      env,clientFactory:()=>client,uuid:()=> 'not-a-uuid'
    }),
    /Invalid synthetic identifiers/
  );
  assert.deepEqual(commands,[]);
});
