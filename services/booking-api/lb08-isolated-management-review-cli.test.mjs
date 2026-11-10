import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('./lb08-isolated-management-review-cli.mjs',import.meta.url));
const add=(id,type)=>({ResourceChange:{Action:'Add',LogicalResourceId:id,
 ResourceType:type,Replacement:'False'}});
const base={Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[
 add('ManagementPreviewApi','AWS::ApiGatewayV2::Api'),
 add('ManagementPreviewReadFunction','AWS::Lambda::Function'),
 add('ManagementPreviewReadFunctionRole','AWS::IAM::Role')]};
const invoke=data=>spawnSync(process.execPath,[cli],
 {input:typeof data==='string'?data:JSON.stringify(data),encoding:'utf8',timeout:10000});
test('LB-08 isolated reviewer CLI succeeds for expected isolated additions',()=>{
 const r=invoke(base);
 assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(r.stdout).clearedForManualReview,true);
});
test('LB-08 isolated reviewer CLI fails closed for public booking changes and unknown IAM',()=>{
 for(const change of [
  add('BookingTable','AWS::DynamoDB::Table'),
  add('BookingFunction','AWS::Lambda::Function'),
  add('ManagementCheckoutFunction','AWS::Lambda::Function'),
  add('UnexpectedRole','AWS::IAM::Role')
 ]){
  assert.equal(invoke({...base,Changes:[...base.Changes,change]}).status,1);
 }
});
test('LB-08 isolated reviewer refuses unprojected parameters and invalid JSON without leaking secrets',()=>{
 const secret='sensitive-fixture-do-not-print';
 const result=invoke({...base,Parameters:[{ParameterValue:secret}]});
 assert.equal(result.status,1);
 assert.doesNotMatch(result.stdout+result.stderr,/sensitive-fixture/);
 assert.equal(invoke('{broken-json').status,1);
 assert.equal(invoke({...base,Status:'CREATE_IN_PROGRESS'}).status,1);
});
