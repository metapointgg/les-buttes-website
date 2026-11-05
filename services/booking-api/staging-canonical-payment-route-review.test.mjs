import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('./staging-canonical-payment-route-review.template.yaml',import.meta.url),'utf8');
test('LB-09 route draft preserves canonical API and requires explicit deployment switch',()=>{
 assert.match(template,/AllowedValues: \[i2irz87c82\]/);
 assert.match(template,/Default: 'false'/);
 assert.match(template,/ApprovedStagingDeployment/);
 assert.match(template,/CorrectRegion/);
 assert.match(template,/RouteKey: 'POST \/admin\/bookings\/\{bookingId\}\/payment\/reconcile'/);
 assert.match(template,/AuthorizationType: JWT/);
 assert.match(template,/AuthorizerId: !Ref CognitoAuthorizerId/);
 assert.doesNotMatch(template,/AWS::ApiGatewayV2::Api|AWS::DynamoDB::Table/);
});
test('LB-09 draft has no write, SumUp credential or SES permissions',()=>{
 assert.match(template,/Action: \[dynamodb:GetItem\]/);
 assert.match(template,/Action: \[logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents\]/);
 assert.doesNotMatch(template,/logs:DeleteLogGroup|logs:DeleteLogStream|logs:DeleteLogEvents/);
 assert.doesNotMatch(template,/dynamodb:(PutItem|UpdateItem|TransactWriteItems)|ssm:GetParameter|ses:SendEmail/);
 for(const flag of ['MANAGEMENT_WRITES_ENABLED','MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED',
  'BOOKING_CONFIRMATION_DISPATCH_ENABLED','BOOKING_EMAILS_ENABLED'])
  assert.ok(template.includes(flag+": 'false'"),flag);
 assert.match(template,/S3ObjectVersion: !Ref ReviewedArtifactVersion/);
 assert.match(template,/S3Bucket: !Ref ReviewedArtifactBucket/);
 assert.match(template,/S3Key: !Ref ReviewedArtifactKey/);
 assert.doesNotMatch(template,/REPLACE_WITH_REVIEWED/);
 assert.match(template,/MANAGEMENT_COGNITO_ISSUER: https:\/\/cognito-idp\.eu-west-2\.amazonaws\.com\/eu-west-2_Wvo0I3cTa/);
 assert.match(template,/MANAGEMENT_COGNITO_CLIENT_ID: 2mjmimjh7oc8h00d4nngrc1akj/);
});

test('LB-09 CloudFormation review template has one coherent parameter and resource graph',()=>{
 for(const section of ['Parameters','Conditions','Resources','Outputs'])
  assert.equal((template.match(new RegExp('^'+section+':','gm'))??[]).length,1,
   section+' must be declared exactly once');
 for(const parameter of ['CanonicalApiId','StagingBookingTableName','CognitoAuthorizerId',
  'ReviewedArtifactBucket','ReviewedArtifactKey','ReviewedArtifactVersion','DeploymentEnabled'])
  assert.match(template,new RegExp('^  '+parameter+':$','m'));
 assert.match(template,/ReviewedArtifactVersion:\n    Type: String\n    MinLength: 1/);
 assert.match(template,/DeploymentEnabled:\n    Type: String\n    AllowedValues: \['false', 'true'\]\n    Default: 'false'/);
 assert.match(template,/PaymentReconciliationFunction:\n    Type: AWS::Lambda::Function\n    Condition: Deploy/);
 assert.match(template,/PaymentReconciliationRoute:\n    Type: AWS::ApiGatewayV2::Route\n    Condition: Deploy/);
 assert.match(template,/PaymentReconciliationPermission:\n    Type: AWS::Lambda::Permission\n    Condition: Deploy/);
 assert.doesNotMatch(template,/REPLACE_WITH_REVIEWED|AllowedPattern: '[^'\n]*Type: String/);
});
