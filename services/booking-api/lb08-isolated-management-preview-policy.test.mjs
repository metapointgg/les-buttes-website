import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const policy=JSON.parse(readFileSync(new URL('../../infra/booking-api/iam-isolated-management-preview-changeset-only.json',import.meta.url),'utf8'));
const preparer=readFileSync(new URL('../../infra/booking-api/prepare-isolated-management-preview-changeset.ps1',import.meta.url),'utf8');
const statements=policy.Statement;
const permissions=statements.flatMap(s=>Array.isArray(s.Action)?s.Action:[s.Action]);
test('LB-08 preview IAM is limited to isolated change-set creation/review and package S3',()=>{
 for(const action of ['cloudformation:CreateChangeSet','cloudformation:DescribeChangeSet',
 'cloudformation:CreateStack','s3:PutObject','s3:GetObject']){
  assert.ok(permissions.includes(action),action);
 }
 for(const action of ['cloudformation:ExecuteChangeSet','cloudformation:UpdateStack',
 'cloudformation:DeleteStack','iam:CreateRole','iam:PassRole','lambda:CreateFunction',
 'dynamodb:PutItem','s3:DeleteObject']){
  assert.ok(!permissions.includes(action),action);
 }
 assert.ok(statements.every(s=>s.Effect==='Allow'));
 assert.ok(statements.every(s=>!JSON.stringify(s.Resource).includes('"*"')));
});
test('LB-08 preview IAM has no access to public booking stack except DescribeStacks',()=>{
 const existing=statements.filter(s=>JSON.stringify(s.Resource).includes('stack/les-buttes-booking-staging/'));
 assert.equal(existing.length,1);
 assert.deepEqual(existing[0].Action,['cloudformation:DescribeStacks']);
});
test('LB-08 package destination exactly matches scoped object policy',()=>{
 const artifacts=statements.find(s=>s.Sid==='IsolatedManagementPreviewArtifacts');
 assert.equal(artifacts.Resource,'arn:aws:s3:::les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/booking-management-preview-isolated/sam/*');
 assert.match(preparer,/--s3-bucket les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/);
 assert.match(preparer,/--s3-prefix booking-management-preview-isolated\/sam/);
});
