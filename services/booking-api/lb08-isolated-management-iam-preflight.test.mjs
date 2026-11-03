import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const preflight=readFileSync(new URL('../../infra/booking-api/check-isolated-management-preview-iam.ps1',import.meta.url),'utf8');
const preparer=readFileSync(new URL('../../infra/booking-api/prepare-isolated-management-preview-changeset.ps1',import.meta.url),'utf8');
test('LB-08 read-only IAM probe verifies account, role and isolated stack resource',()=>{
 assert.match(preflight,/145608514666/);
 assert.match(preflight,/les-buttes-booking-private-staging-deploy/);
 assert.match(preflight,/les-buttes-management-preview-isolated-staging/);
 assert.match(preflight,/iam simulate-principal-policy/);
 assert.doesNotMatch(preflight,/put-role-policy|attach-role-policy|create-policy|execute-change-set|create-change-set/);
});
test('LB-08 requires CloudFormation preview and scoped S3 upload permissions',()=>{
 for(const action of ['cloudformation:CreateChangeSet','cloudformation:DescribeChangeSet',
 'cloudformation:DescribeStacks','s3:PutObject','s3:GetObject']){
  assert.ok(preflight.includes(action),action);
 }
 assert.match(preflight,/booking-management-preview-isolated\/sam/);
});
test('LB-08 preparer checks IAM before SAM packaging and does not execute',()=>{
 const iam=preparer.indexOf("check-isolated-management-preview-iam.ps1");
 const packagePosition=preparer.indexOf(" & sam package ");
 assert.ok(iam>=0&&packagePosition>iam);
 assert.doesNotMatch(preparer,/execute-change-set|--no-confirm-changeset|sam deploy/);
});
