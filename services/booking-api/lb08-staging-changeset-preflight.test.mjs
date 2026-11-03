import test from 'node:test';import assert from 'node:assert/strict';
import {verifyStagingChangeSetPreflight} from './lb08-staging-changeset-preflight.mjs';
const stack={StackName:'les-buttes-booking-staging',StackStatus:'UPDATE_COMPLETE',
 Parameters:[{ParameterKey:'BookingEnvironment',ParameterValue:'staging'},
  {ParameterKey:'BookingRequestsEnabled',ParameterValue:'true'},
  {ParameterKey:'CalendarMonitorEnabled',ParameterValue:'true'}]};
const table={TableName:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',
 TableStatus:'ACTIVE',GlobalSecondaryIndexes:[{IndexName:'BookingRequestsIndex',IndexStatus:'ACTIVE'}]};
const proposed={BookingRequestsIndexEnabled:'true',ManagementApprovalEnabled:'false',
 ManagementCheckoutEnabled:'false',BookingEnvironment:'staging',
 BookingRequestsEnabled:'true',CalendarMonitorEnabled:'true'};
const input={account:'145608514666',stack,table,proposed};
test('LB-08 allows change-set preparation only with preserved index and default-disabled payments',()=>{
 assert.deepEqual(verifyStagingChangeSetPreflight(input),
  {safeToPrepareChangeSet:true,failures:[],observedIndexStatus:'ACTIVE',stackStatus:'UPDATE_COMPLETE'});
});
test('LB-08 blocks missing index opt-in even if live index is active',()=>{
 for(const value of [undefined,'false']){
  const result=verifyStagingChangeSetPreflight({...input,proposed:{...proposed,BookingRequestsIndexEnabled:value}});
  assert.equal(result.safeToPrepareChangeSet,false);
  assert.match(result.failures.join(' '),/BookingRequestsIndexEnabled=true/);
 }
});
test('LB-08 blocks payment enablement, index absence, stack instability and account mismatch',()=>{
 for(const alteration of [
  {account:'999999999999'},
  {stack:{...stack,StackStatus:'UPDATE_IN_PROGRESS'}},
  {table:{...table,GlobalSecondaryIndexes:[]}},
  {table:{...table,TableStatus:'UPDATING'}},
  {proposed:{...proposed,ManagementCheckoutEnabled:'true'}},
  {proposed:{...proposed,ManagementApprovalEnabled:'true'}},
  {proposed:{...proposed,CalendarMonitorEnabled:'false'}}
 ]){
  assert.equal(verifyStagingChangeSetPreflight({...input,...alteration}).safeToPrepareChangeSet,false);
 }
});
