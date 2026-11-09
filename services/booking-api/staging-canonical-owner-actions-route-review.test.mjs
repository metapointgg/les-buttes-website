import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('./staging-canonical-owner-actions-route-review.template.yaml',import.meta.url),'utf8');
test('canonical owner actions attach to existing API and JWT authoriser without a second app',()=>{
 assert.match(template,/AllowedValues: \[i2irz87c82\]/);
 assert.match(template,/AllowedValues: \[q9ukxh\]/);
 assert.match(template,/RouteKey: 'POST \/admin\/bookings\/\{bookingId\}\/actions\/\{action\}'/);
 assert.match(template,/AuthorizationType: JWT/);
 assert.match(template,/AuthorizerId: !Ref CognitoAuthorizerId/);
 assert.doesNotMatch(template,/AWS::ApiGatewayV2::Api|AWS::DynamoDB::Table/);
});
test('canonical owner actions use immutable code and disabled-by-default staging writes',()=>{
 assert.match(template,/Handler: staging-owner-action-route-handler.handler/);
 assert.match(template,/S3ObjectVersion: !Ref ReviewedArtifactVersion/);
 assert.match(template,/StagingOwnerActionsEnabled:\n    Type: String\n    AllowedValues: \['false', 'true'\]\n    Default: 'false'/);
 assert.match(template,/MANAGEMENT_WRITES_ENABLED: !Ref StagingOwnerActionsEnabled/);
 assert.match(template,/MANAGEMENT_APPROVAL_ENABLED: !Ref StagingOwnerActionsEnabled/);
 assert.match(template,/Action: \[dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:DeleteItem, dynamodb:ConditionCheckItem\]/);
 assert.doesNotMatch(template,/ssm:GetParameter|dynamodb:TransactWriteItems/);
});

test('SES sending is restricted to the simulator and disabled by default',()=>{
 assert.match(template,/ses:SendEmail/);
 assert.match(template,/ses:Recipients: \[success@simulator\.amazonses\.com\]/);
 assert.match(template,/ses:FromAddress: info@lesbuttes\.com/);
 assert.match(template,/BOOKING_LIFECYCLE_DISPATCH_ENABLED: 'false'/);
});
