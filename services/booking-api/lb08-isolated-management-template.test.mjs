import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('./staging-management-preview-isolated.template.yaml',import.meta.url),'utf8');
test('LB-08 isolated management stack references rather than creates the staging booking table',()=>{
 assert.match(template,/StagingBookingTableName:/);
 assert.match(template,/BookingRequestsIndex/);
 assert.doesNotMatch(template,/Type: AWS::DynamoDB::Table|Type: AWS::SSM::Parameter/);
 assert.doesNotMatch(template,/BookingFunction:|CalendarMonitorFunction:|BookingApi:/);
 assert.match(template,/Condition: StagingRegion/);
});
test('LB-08 isolated preview exposes only Cognito-JWT GET routes',()=>{
 assert.match(template,/DefaultAuthorizer: ManagementJwt/);
 assert.match(template,/Authorizer: ManagementJwt/);
 assert.match(template,/Path: \/admin\/\{proxy\+\}/);
 assert.match(template,/Method: GET/);
 assert.doesNotMatch(template,/Method: (POST|ANY)|Path: \/\{proxy\+\}/);
 assert.match(template,/AllowMethods: \[GET, OPTIONS\]/);
});
test('LB-08 isolated preview cannot create checkout or modify booking state',()=>{
 const iam=template.slice(template.indexOf('      Policies:'),template.indexOf('      Events:'));
 assert.match(iam,/dynamodb:GetItem, dynamodb:Query/);
 assert.doesNotMatch(iam,/dynamodb:(PutItem|UpdateItem|DeleteItem|TransactWriteItems)|ssm:GetParameter|ses:SendEmail/);
 for(const setting of ['MANAGEMENT_WRITES_ENABLED','MANAGEMENT_APPROVAL_ENABLED','MANAGEMENT_CHECKOUT_ENABLED'])
  assert.ok(template.includes(setting+": 'false'"),setting);
 assert.match(template,/BOOKING_ENVIRONMENT: staging/);
 assert.match(template,/ReservedConcurrentExecutions: 2/);
});
