import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../infra/booking-api/production-services-review.template.yaml',import.meta.url),'utf8');
const terms=readFileSync(new URL('./BOOKING_TERMS_DRAFT_2027.md',import.meta.url),'utf8');
const paymentTerms=readFileSync(new URL('./DIRECT_BOOKING_TERMS_PAYMENT_DRAFT.md',import.meta.url),'utf8');

test('production services reuse the isolated table and keep every transactional release gate disabled by default',()=>{
 assert.match(source,/ProductionBookingTableName/);
 assert.match(source,/les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2/);
 assert.match(source,/RouteKey: POST \/request/);
 assert.match(source,/ProductionRequestTransactionBoundary/);
 assert.match(source,/PaymentsEnabled:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/LivePaymentsApproved:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/REFUNDS_ENABLED: 'false'/);
 assert.match(source,/EmailsEnabled:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/LiveEmailsApproved:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/EMAILS_ENABLED: !Ref EmailsEnabled/);
 assert.match(source,/LIVE_EMAILS_APPROVED: !Ref LiveEmailsApproved/);
 assert.match(source,/Action: ses:SendEmail/);
 assert.doesNotMatch(source,/ses:\*/i);
 assert.match(source,/identity\/lesbuttes\.com/);
 assert.match(source,/BOOKING_SES_FROM: bookings@lesbuttes\.com/);
 assert.match(source,/BOOKING_OWNER_EMAIL: mike@lesbuttes\.com/);
 assert.match(source,/BookingRequestsEnabled:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/ManagementWritesEnabled:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/parameter\/les-buttes\/booking\/production\/turnstile\/secret/);
 assert.match(source,/parameter\/les-buttes\/booking\/production\/sumup\/api-key/);
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

test('production writes are confined to the calendar importer and default-off transactional roles',()=>{
 assert.match(source,/ProductionInboundCalendarSnapshot/);
 assert.match(source,/Action: dynamodb:PutItem/);
 assert.match(source,/dynamodb:LeadingKeys: \[UNIT#geranium, UNIT#honeysuckle\]/);
 assert.match(source,/'Null':\s+dynamodb:LeadingKeys: 'false'/);
 assert.match(source,/PolicyName: ProductionRequestTransactionBoundary[\s\S]{0,900}dynamodb:TransactWriteItems/);
 assert.match(source,/PolicyName: ProductionBookingTransactions[\s\S]{0,900}dynamodb:TransactWriteItems/);
 assert.match(source,/MANAGEMENT_WRITES_ENABLED: !Ref ManagementWritesEnabled/);
 assert.match(source,/BOOKING_REQUESTS_ENABLED: !Ref BookingRequestsEnabled/);
 assert.match(source,/BOOKING_REQUEST_DISPATCH_ENABLED: !Ref EmailsEnabled/);
 assert.match(source,/BOOKING_LIFECYCLE_DISPATCH_ENABLED: !Ref EmailsEnabled/);
});

test('production API and functions have bounded structured operational logging',()=>{
 assert.match(source,/ProductionApiAccessLogGroup:[\s\S]*RetentionInDays: 90/);
 assert.match(source,/AccessLogSettings:[\s\S]*DestinationArn: !GetAtt ProductionApiAccessLogGroup\.Arn/);
 assert.match(source,/ThrottlingBurstLimit: 20/);
 assert.match(source,/ThrottlingRateLimit: 10/);
 assert.equal((source.match(/RetentionInDays: 90/g)??[]).length,9);
 assert.equal((source.match(/LogFormat: JSON/g)??[]).length,8);
 assert.doesNotMatch(source,/Action: \[logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents\]/);
});

test('unpublished terms drafts do not contradict the approved full-payment Strict policy',()=>{
 assert.match(terms,/approved Strict-style direct-booking business rules/);
 assert.match(paymentTerms,/standard intended payment is the full owner-approved amount/);
 assert.match(paymentTerms,/100% within 24 hours of confirmation/);
 assert.doesNotMatch(paymentTerms,/25%|56 full days|within 56 days/);
});


test('production owner checkout status is readable through JWT-protected read-only route',()=>{
 const code=readFileSync(new URL('./production-admin-read-handler.mjs',import.meta.url),'utf8');
 assert.match(code,/readRegisteredCheckout/);
 assert.match(code,/readCheckout:\(\{bookingId\}\)=>readRegisteredCheckout/);
 assert.match(code,/writeEnabled:\(\)=>false/);
 assert.match(source,/GET \/admin\/production\/bookings\/\{proxy\+\}/);
});
