import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../infra/booking-api/production-services-review.template.yaml',import.meta.url),'utf8');

test('production services reuse the isolated table and expose no customer write route',()=>{
 assert.match(source,/ProductionBookingTableName/);
 assert.match(source,/les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2/);
 assert.doesNotMatch(source,/RouteKey:\s*POST|Action:\s*\[?ses:|sumup/i);
 assert.match(source,/BOOKING_REQUESTS_ENABLED: 'false'/);
 assert.match(source,/MANAGEMENT_WRITES_ENABLED: 'false'/);
});

test('production feeds use two independently managed secure parameters',()=>{
 assert.match(source,/calendar\/geranium-token/);
 assert.match(source,/calendar\/honeysuckle-token/);
 assert.match(source,/CALENDAR_TOKEN_SSM_PREFIX/);
 assert.match(source,/GET \/calendar\/\{proxy\+\}/);
});

test('only inbound snapshots can write the production table',()=>{
 assert.match(source,/ProductionInboundCalendarSnapshot/);
 assert.match(source,/Action: dynamodb:PutItem/);
 assert.match(source,/dynamodb:LeadingKeys: \[UNIT#geranium, UNIT#honeysuckle\]/);
 assert.doesNotMatch(source,/dynamodb:(?:UpdateItem|DeleteItem|TransactWriteItems)/);
});
