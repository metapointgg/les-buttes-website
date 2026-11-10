import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('./lb08-management-changeset-review-cli.mjs',import.meta.url));
const valid={Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[
 {ResourceChange:{Action:'Add',LogicalResourceId:'ManagementApi',
 ResourceType:'AWS::ApiGatewayV2::Api',Replacement:'False'}}]};
function invoke(body){
 return spawnSync(process.execPath,[cli],{input:body,encoding:'utf8',timeout:10000});
}
test('LB-08 CLI executes as a real process and accepts only reviewed management additions',()=>{
 const result=invoke(JSON.stringify(valid));
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).clearedForManualReview,true);
});
test('LB-08 CLI exits nonzero for table changes and secrets in input',()=>{
 const table=invoke(JSON.stringify({...valid,Changes:[
  {ResourceChange:{Action:'Modify',LogicalResourceId:'BookingTable',
   ResourceType:'AWS::DynamoDB::Table',Replacement:'False'}}]}));
 assert.equal(table.status,1);
 const unsafe=invoke(JSON.stringify({...valid,Parameters:[{ParameterValue:'do-not-expose'}]}));
 assert.equal(unsafe.status,1);
 assert.doesNotMatch(unsafe.stdout+unsafe.stderr,/do-not-expose/);
});
test('LB-08 CLI exits nonzero for malformed data and no change-set changes',()=>{
 assert.equal(invoke('{invalid').status,1);
 assert.equal(invoke(JSON.stringify({...valid,Changes:[]})).status,1);
});
