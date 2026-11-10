import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../infra/booking-api/production-services-review.template.yaml',import.meta.url),'utf8');

test('production services reuse the isolated table and keep the deployed request boundary disabled',()=>{
 assert.match(source,/ProductionBookingTableName/);
 assert.match(source,/les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2/);
 assert.match(source,/RouteKey: POST \/request/);
 assert.match(source,/ProductionRequestBoundaryLogsOnly/);
 assert.match(source,/PAYMENTS_ENABLED: 'false'/);
 assert.match(source,/REFUNDS_ENABLED: 'false'/);
 assert.match(source,/EMAILS_ENABLED: 'false'/);
 assert.doesNotMatch(source,/Action:\s*\[?ses:|sumup/i);
 assert.match(source,/BOOKING_REQUESTS_ENABLED: 'false'/);
 assert.match(source,/MANAGEMENT_WRITES_ENABLED: 'false'/);
});

test('production quote route has read-only database permissions',()=>{
 assert.match(source,/RouteKey: GET \/quote/);
 assert.match(source,/PolicyName: ProductionQuoteReadOnly/);
 assert.match(source,/Action: \[dynamodb:GetItem, dynamodb:Query\]/);
 assert.doesNotMatch(source,/ProductionQuoteReadOnly[\s\S]{0,900}dynamodb:(?:PutItem|UpdateItem|DeleteItem|TransactWriteItems)/);
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
 assert.match(source,/'Null':\s+dynamodb:LeadingKeys: 'false'/);
 assert.doesNotMatch(source,/dynamodb:(?:UpdateItem|DeleteItem|TransactWriteItems)/);
});

test('production API and functions have bounded structured operational logging',()=>{
 assert.match(source,/ProductionApiAccessLogGroup:[\s\S]*RetentionInDays: 90/);
 assert.match(source,/AccessLogSettings:[\s\S]*DestinationArn: !GetAtt ProductionApiAccessLogGroup\.Arn/);
 assert.match(source,/ThrottlingBurstLimit: 20/);
 assert.match(source,/ThrottlingRateLimit: 10/);
 assert.equal((source.match(/RetentionInDays: 90/g)??[]).length,7);
 assert.equal((source.match(/LogFormat: JSON/g)??[]).length,6);
 assert.doesNotMatch(source,/Action: \[logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents\]/);
});
