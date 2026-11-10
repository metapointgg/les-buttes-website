import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectManagementPreviewChangeSet} from './lb08-management-changeset-review.mjs';
const add=(id,type='AWS::Lambda::Function')=>({ResourceChange:{
 LogicalResourceId:id,ResourceType:type,Action:'Add',Replacement:'False'}});
const args={status:'CREATE_COMPLETE',executionStatus:'AVAILABLE',
 changes:[add('ManagementApi','AWS::ApiGatewayV2::Api'),
  add('ManagementReadOnlyFunction')]};
test('LB-08 only accepts available unexecuted read-only management additions for manual review',()=>{
 const result=inspectManagementPreviewChangeSet(args);
 assert.equal(result.clearedForManualReview,true);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.review.length,2);
});
test('LB-08 stops existing table, API, monitoring and Lambda modifications',()=>{
 for(const id of ['BookingTable','BookingApi','BookingFunction','CalendarMonitorFunction']){
  const result=inspectManagementPreviewChangeSet({...args,changes:[{
   ResourceChange:{...add(id).ResourceChange,Action:'Modify',Replacement:'False'}}]});
  assert.equal(result.clearedForManualReview,false,id);
 }
});
test('LB-08 refuses payments, IAM surprises, replacement, deletion and incomplete change sets',()=>{
 for(const change of [
  add('ManagementCheckoutFunction'),
  add('ManagementWriteFunction'),
  add('SurpriseRole','AWS::IAM::Role'),
  {ResourceChange:{...add('ManagementReadOnlyFunction').ResourceChange,Replacement:'Conditional'}},
  {ResourceChange:{...add('ManagementReadOnlyFunction').ResourceChange,Action:'Remove'}}
 ]){
  assert.equal(inspectManagementPreviewChangeSet({...args,changes:[change]}).clearedForManualReview,false);
 }
 for(const status of ['CREATE_PENDING','FAILED']){
  assert.equal(inspectManagementPreviewChangeSet({...args,status}).clearedForManualReview,false);
 }
 assert.equal(inspectManagementPreviewChangeSet({...args,changes:[]}).clearedForManualReview,false);
});
