import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../../infra/booking-api/prepare-management-preview-changeset.ps1',import.meta.url),'utf8');
test('LB-08 management preview refuses unexpected account, stack and missing active index',()=>{
 assert.match(script,/145608514666/);
 assert.match(script,/les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK/);
 assert.match(script,/BookingRequestsIndex' -and \$_.IndexStatus -eq 'ACTIVE'/);
 assert.match(script,/StackStatus -ne 'UPDATE_COMPLETE'/);
 assert.match(script,/CalendarMonitorEnabled='true'/);
 assert.match(script,/BookingRequestsEnabled='true'/);
});
test('LB-08 preview preserves existing parameters, index, and disables all payment writes',()=>{
 assert.match(script,/UsePreviousValue=\$true/);
 for(const setting of ["BookingRequestsIndexEnabled='true'","ManagementPreviewEnabled='true'",
  "ManagementWritesEnabled='false'","ManagementApprovalEnabled='false'",
  "ManagementCheckoutEnabled='false'"]){
  assert.ok(script.includes(setting),setting);
 }
 assert.match(script,/if\(-not \$Prepare\)/);
 assert.match(script,/create-change-set/);
 assert.doesNotMatch(script,/execute-change-set|sam deploy|aws cloudformation deploy/);
});
