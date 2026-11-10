import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../../infra/booking-api/a09-canonical-owner-action-deployment-review.json',import.meta.url),'utf8'));
const template=readFileSync(new URL('./staging-canonical-owner-actions-route-review.template.yaml',import.meta.url),'utf8');
test('A09 deployment review pins a single immutable staging-only artefact',()=>{
 assert.equal(manifest.awsAccount,'145608514666');
 assert.equal(manifest.region,'eu-west-2');
 assert.equal(manifest.canonicalApiId,'i2irz87c82');
 assert.equal(manifest.cognitoAuthorizerId,'q9ukxh');
 assert.match(manifest.bookingTable,/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/);
 assert.equal(manifest.artifact.bucket,'les-buttes-payment-staging-145608514666-eu-west-2');
 assert.match(manifest.artifact.sourceCommit,/^[0-9a-f]{40}$/);
 assert.equal(manifest.artifact.key,'payment-review/'+manifest.artifact.sourceCommit+'/canonical-staging-owner-actions-lambda.zip');
 assert.ok(manifest.artifact.version.length>10);
 assert.equal(manifest.executionApproved,false);
});
test('A09 reviewed template requires explicit deployment and keeps writes disabled',()=>{
 assert.equal(manifest.initialParameters.StagingOwnerActionsEnabled,'false');
 assert.match(template,/DeploymentEnabled:\n    Type: String\n    AllowedValues: \['false', 'true'\]\n    Default: 'false'/);
 assert.match(template,/StagingOwnerActionsEnabled:\n    Type: String\n    AllowedValues: \['false', 'true'\]\n    Default: 'false'/);
 assert.match(template,/S3ObjectVersion: !Ref ReviewedArtifactVersion/);
 assert.match(template,/MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED: 'false'/);
 assert.match(template,/BOOKING_CONFIRMATION_DISPATCH_ENABLED: 'false'/);
 assert.doesNotMatch(template,/AWS::ApiGatewayV2::Api|AWS::DynamoDB::Table/);
});
