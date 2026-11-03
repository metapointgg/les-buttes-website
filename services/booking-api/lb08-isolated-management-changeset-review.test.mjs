import test from 'node:test';import assert from 'node:assert/strict';
import {inspectIsolatedManagementChangeSet} from './lb08-isolated-management-changeset-review.mjs';
const add=(LogicalResourceId,ResourceType)=>({ResourceChange:{Action:'Add',
 LogicalResourceId,ResourceType,Replacement:'False'}});
const valid=[add('ManagementPreviewApi','AWS::ApiGatewayV2::Api'),
 add('ManagementPreviewApiApiGatewayDefaultStage','AWS::ApiGatewayV2::Stage'),
 add('ManagementPreviewReadFunction','AWS::Lambda::Function'),
 add('ManagementPreviewReadFunctionRole','AWS::IAM::Role'),
 add('ManagementPreviewReadFunctionGetManagementPreviewPermission','AWS::Lambda::Permission')];
const args={status:'CREATE_COMPLETE',executionStatus:'AVAILABLE',changes:valid};
test('LB-08 accepts only new isolated read-only infrastructure for manual inspection',()=>{
 const r=inspectIsolatedManagementChangeSet(args);
 assert.equal(r.clearedForManualReview,true,r.blockers.join('; '));
});
test('LB-08 refuses table, public booking resource and unexpected payment IAM changes',()=>{
 for(const resource of [
  add('BookingTable','AWS::DynamoDB::Table'),
  add('BookingFunction','AWS::Lambda::Function'),
  add('ManagementCheckoutFunction','AWS::Lambda::Function'),
  add('ManagementPreviewReadFunctionWritePolicy','AWS::IAM::Policy'),
  add('ManagementPreviewApiNewTable','AWS::DynamoDB::Table')
 ]){
  assert.equal(inspectIsolatedManagementChangeSet({...args,changes:[...valid,resource]}).clearedForManualReview,false);
 }
});
test('LB-08 rejects modifications, replacements and incomplete change sets',()=>{
 for(const resource of [
  {ResourceChange:{...valid[0].ResourceChange,Action:'Modify'}},
  {ResourceChange:{...valid[0].ResourceChange,Replacement:'True'}},
  {ResourceChange:{...valid[0].ResourceChange,Replacement:'Conditional'}}
 ]){
  assert.equal(inspectIsolatedManagementChangeSet({...args,changes:[...valid,resource]}).clearedForManualReview,false);
 }
 assert.equal(inspectIsolatedManagementChangeSet({...args,status:'CREATE_IN_PROGRESS'}).clearedForManualReview,false);
 assert.equal(inspectIsolatedManagementChangeSet({...args,changes:[]}).clearedForManualReview,false);
});
