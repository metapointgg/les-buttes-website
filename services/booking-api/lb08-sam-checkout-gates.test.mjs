// LB-08 infrastructure regression guard. SAM lint validates the YAML separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('../../infra/booking-api/template.yaml',import.meta.url),'utf8');
const between=(start,end)=>{
 const a=template.indexOf(start),b=template.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Expected SAM section '+start);
 return template.slice(a,b);
};
test('LB-08 payment and approval switches are independently default-off',()=>{
 for(const name of ['ManagementApprovalEnabled','ManagementCheckoutEnabled']){
  const block=between('  '+name+':\n','  '+(name==='ManagementApprovalEnabled'?
   'ManagementCheckoutEnabled':'ManagementCognitoPoolId')+':\n');
  assert.match(block,/Default: 'false'/);
  assert.match(block,/AllowedValues: \['true', 'false'\]/);
 }
 assert.match(template,/ManagementCheckoutEnabledCondition: !And\n\s+- !Condition ManagementWritesEnabledCondition/);
 assert.match(template,/- !Equals \[!Ref ManagementCheckoutEnabled, 'true'\]/);
});
test('LB-08 checkout has its own staging-only JWT route and narrow role',()=>{
 const block=between('  ManagementCheckoutFunction:\n','  CalendarMonitorCheckpointTable:\n');
 assert.match(block,/Condition: ManagementCheckoutEnabledCondition/);
 assert.match(block,/Handler: booking-admin-http\.handler/);
 assert.match(block,/MANAGEMENT_CHECKOUT_ENABLED: 'true'/);
 assert.match(block,/MANAGEMENT_APPROVAL_ENABLED: 'false'/);
 assert.match(block,/Action: ssm:GetParameter/);
 assert.match(block,/parameter\/les-buttes\/staging\/sumup\/api-key/);
 assert.match(block,/parameter\/les-buttes\/staging\/sumup\/merchant-code/);
 assert.match(block,/Path: \/admin\/bookings\/\{bookingId\}\/checkout\/register/);
 assert.match(block,/Authorizer: ManagementCognito/);
 assert.doesNotMatch(block,/Method: ANY|Path: \/\{proxy\+\}|dynamodb:\*|Resource: '\*'/);
});
test('LB-08 public booking API retains no owner checkout or payment routes',()=>{
 const block=between('  BookingFunction:\n','  # Entire management surface');
 assert.doesNotMatch(block,/checkout\/register|MANAGEMENT_CHECKOUT_ENABLED|MANAGEMENT_APPROVAL_ENABLED/);
});
