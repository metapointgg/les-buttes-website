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
 assert.match(source,/ses:FromAddress: bookings@lesbuttes\.com/);
 assert.equal((source.match(/ses:FromAddress: bookings@lesbuttes\.com/g)??[]).length,2);
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
 assert.match(source,/DestinationArn: !Sub 'arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/apigateway\/les-buttes-booking-production-read'/);
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


test('production checkout status does not inherit the staging-only reader gate',()=>{
 const source=readFileSync(new URL('./production-admin-read-handler.mjs',import.meta.url),'utf8');
 assert.match(source,/deploymentAllowed:\(\)=>process\.env\.BOOKING_ENVIRONMENT==='production'/);
 assert.match(source,/TABLE\.test\(process\.env\.BOOKINGS_TABLE\?\?''\)/);
 assert.match(source,/readCheckout:\(\{bookingId\}\)=>readRegisteredCheckout/);
 assert.match(source,/writeEnabled:\(\)=>false/);
});


test('production reconciliation uses existing transaction Lambda with an independently disabled schedule',()=>{
 const transaction=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 assert.match(source,/AutomaticPaymentReconciliationEnabled:[\s\S]{0,120}Default: 'false'/);
 assert.match(source,/PaymentScheduleActivated: !And/);
 assert.match(source,/State: !If \[PaymentScheduleActivated, ENABLED, DISABLED\]/);
 assert.match(source,/Name: les-buttes-production-payment-reconciliation/);
 assert.match(source,/SourceArn: !GetAtt ProductionPaymentReconciliationSchedule\.Arn/);
 assert.match(source,/BOOKING_AUTOMATIC_RECONCILIATION_ENABLED: !Ref AutomaticPaymentReconciliationEnabled/);
 assert.match(transaction,/reconcileScheduledProductionPayments\(event\)/);
 assert.match(transaction,/if\(event\?\.source==='aws\.events'/);
});


test('one-time £1 live acceptance is server-bound and default-off without changing published pricing',()=>{
 const request=readFileSync(new URL('./production-request-handler.mjs',import.meta.url),'utf8');
 const index=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
 const admin=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 assert.match(source,/ControlledTestOnlyEnabled:[\s\S]{0,125}Default: 'false'/);
 assert.match(source,/BOOKING_CONTROLLED_TEST_ONLY_ENABLED: !Ref ControlledTestOnlyEnabled/g);
 assert.match(source,/parameter\/les-buttes\/booking\/production\/test\/one-time-access/);
 assert.match(request,/matchesControlledAccess\(input\.testAccessCode,testAccess\)/);
 assert.match(request,/delete input\.testAccessCode/);
 assert.match(index,/controlledTestBookingClaim\(table,id\)/);
 assert.match(admin,/args\.approval\?\.amountPence!==TEST_APPROVAL_PENCE/);
 assert.match(admin,/Number\(booking\.approvedAmountGBP\)!==1/);
});


test('owner approval automatically registers live checkout and dispatches the guest payment link',()=>{
 const transaction=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 assert.match(transaction,/if\(args\.action==='approve'\)\{/);
 assert.match(transaction,/await registerCheckoutWithLiveSumUp\(\{db,bookingId:args\.bookingId/);
 assert.match(transaction,/checkout\?\.status!=='REGISTERED'/);
 assert.match(transaction,/notificationStatus=await notify\(args\.bookingId,'approval_payment'\)/);
 assert.match(transaction,/checkoutStatus='OWNER_ACTION_REQUIRED'/);
 assert.match(transaction,/PRODUCTION_APPROVAL_CHECKOUT_REVIEW/);
 assert.match(transaction,/BOOKING_CONTROLLED_TEST_ONLY_ENABLED/);
});


test('production unpaid booking cancellation verifies SumUp expiry before releasing any inventory',()=>{
 const admin=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 const core=readFileSync(new URL('./production-unpaid-booking-cancellation.mjs',import.meta.url),'utf8');
 const gateway=readFileSync(new URL('./booking-admin-http.mjs',import.meta.url),'utf8');
 assert.match(admin,/deactivationEnabled:\(\)=>process\.env\.BOOKING_CONTROLLED_TEST_ONLY_ENABLED!=='true'/);
 assert.match(admin,/cancelUnpaidProductionBooking/);
 assert.match(gateway,/checkout\\\/deactivate/);
 assert.match(source,/RouteKey: POST \/admin\/production\/bookings\/\{bookingId\}\/checkout\/deactivate/);
 assert.match(source,/ProductionCheckoutDeactivateRoute:[\s\S]{0,320}AuthorizationType: JWT[\s\S]{0,120}AuthorizerId: !Ref CognitoAuthorizerId/);
 assert.match(core,/await sumup\.deactivateCheckout\(checkout\.checkoutId\)/);
 assert.match(core,/const after=await sumup\.retrieveCheckout\(checkout\.checkoutId\)/);
 assert.ok(core.indexOf('const after=await sumup.retrieveCheckout')<core.indexOf('const actions=['));
 assert.match(core,/attribute_not_exists\(paidAt\) AND attribute_not_exists\(paymentTransactionId\)/);
 assert.match(core,/refundInitiated:false/);
});

test('production booking deployment requires an explicit immutable email artefact for the two email Lambdas',()=>{
 const parameters=source.slice(source.indexOf('Parameters:'),source.indexOf('Conditions:'));
 assert.match(parameters,/EmailReleaseArtifactKey:[\s\S]{0,80}MinLength: 1/);
 assert.match(parameters,/EmailReleaseArtifactVersion:[\s\S]{0,80}MinLength: 1/);
 assert.doesNotMatch(parameters,/EmailReleaseArtifactKey:[\s\S]{0,80}Default:/);
 const req=source.slice(source.indexOf('  DisabledRequestFunction:'),source.indexOf('  DisabledRequestIntegration:'));
 const owner=source.slice(source.indexOf('  ProductionAdminTransactionFunction:'),source.indexOf('  ProductionAdminTransactionIntegration:'));
 for(const body of [req,owner]){
  assert.match(body,/S3Key: !Ref EmailReleaseArtifactKey/);
  assert.match(body,/S3ObjectVersion: !Ref EmailReleaseArtifactVersion/);
 }
 assert.equal((source.match(/S3Key: !Ref EmailReleaseArtifactKey/g)??[]).length,2);
 assert.equal((source.match(/S3ObjectVersion: !Ref EmailReleaseArtifactVersion/g)??[]).length,2);
 assert.equal((source.match(/S3Key: !Ref ReviewedArtifactKey/g)??[]).length,6);
});

test('production global payment policy has an explicit authenticated owner-only publish route',()=>{
 assert.match(source,/RouteKey: POST \/admin\/production\/config\/payments\/all\/publish/);
 assert.match(source,/ProductionPaymentPolicyPublishRoute:[\s\S]{0,450}AuthorizationType: JWT[\s\S]{0,80}AuthorizerId: !Ref CognitoAuthorizerId/);
 assert.match(source,/ProductionPaymentPolicyPublishRoute:[\s\S]{0,550}ProductionAdminTransactionIntegration/);
 const transaction=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 assert.match(transaction,/publishProductionPaymentSettings/);
 assert.match(transaction,/args\.kind!=='payments'\|\|args\.unit!=='all'/);
});

test('durable guest payment session uses existing protected production Lambda, without a new unauthenticated owner route',()=>{
 assert.match(source,/ProductionGuestBalanceRoute:/);
 assert.match(source,/RouteKey: POST \/balance\/checkout/);
 assert.match(source,/ProductionGuestBalanceIntegration:[\s\S]{0,350}IntegrationUri: !GetAtt ProductionAdminTransactionFunction\.Arn/);
 assert.match(source,/ProductionGuestBalancePermission:[\s\S]{0,500}POST\/balance\/checkout/);
 const handler=readFileSync(new URL('./production-admin-transaction-handler.mjs',import.meta.url),'utf8');
 assert.match(handler,/guestBalanceHandler\(event\)/);
 const guest=readFileSync(new URL('./production-guest-balance-handler.mjs',import.meta.url),'utf8');
 assert.match(guest,/verifyBalancePaymentAccess/);
 assert.match(guest,/BOOKING_CONTROLLED_TEST_ONLY_ENABLED/);
 assert.match(guest,/!ALLOWED\.has\(origin\)/);
 assert.match(guest,/ensureBalanceCheckout/);
});
