import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('./lb08-isolated-acceptance-table.template.yaml',import.meta.url),'utf8');
test('LB-08 isolated DynamoDB table name remains compatible with staging-only reconciler',()=>{
 const match=template.match(/TableName:\s*(les-buttes-[a-z0-9-]+)/);
 assert.ok(match,'Isolated table must have a fixed name');
 assert.equal(match[1],'les-buttes-lb08-staging-isolated-acceptance');
 assert.match(match[1],/staging/);
 assert.doesNotMatch(match[1],/booking-staging-BookingTable/);
 assert.match(template,/DeletionPolicy: Delete/);
 assert.match(template,/BillingMode: PAY_PER_REQUEST/);
});
