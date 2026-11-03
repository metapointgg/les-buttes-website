// LB-08 staging stack preflight for preparing (never executing) a change set.
// Do not trust template defaults for the booking index: the deployed stack may
// predate these parameters while already containing BookingRequestsIndex.
const STACK='les-buttes-booking-staging';
const TABLE='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
export function verifyStagingChangeSetPreflight({account,stack,table,proposed}={}){
 const failures=[];
 if(account!=='145608514666')failures.push('Unexpected AWS account');
 if(stack?.StackName!==STACK||stack.StackStatus!=='UPDATE_COMPLETE')
  failures.push('Staging stack is not update-complete');
 if(table?.TableName!==TABLE||table.TableStatus!=='ACTIVE')
  failures.push('Authoritative staging table not active');
 const index=(table?.GlobalSecondaryIndexes??[]).find(i=>i.IndexName==='BookingRequestsIndex');
 if(index?.IndexStatus!=='ACTIVE')failures.push('BookingRequestsIndex not active');
 const params=Object.fromEntries((stack?.Parameters??[]).map(x=>[x.ParameterKey,x.ParameterValue]));
 if(params.BookingEnvironment!=='staging')failures.push('Current stack is not staging');
 if(proposed?.BookingRequestsIndexEnabled!=='true')
  failures.push('Explicit BookingRequestsIndexEnabled=true required; never use template default');
 for(const flag of ['ManagementApprovalEnabled','ManagementCheckoutEnabled']){
  if(proposed?.[flag]!=='false')failures.push(flag+' must remain explicitly false');
 }
 for(const key of ['CalendarMonitorEnabled','BookingRequestsEnabled','BookingEnvironment']){
  if(typeof params[key]==='string'&&proposed?.[key]!==params[key])
   failures.push('Existing '+key+' setting must be retained');
 }
 return {safeToPrepareChangeSet:failures.length===0,failures,
  observedIndexStatus:index?.IndexStatus??'MISSING',stackStatus:stack?.StackStatus??null};
}
