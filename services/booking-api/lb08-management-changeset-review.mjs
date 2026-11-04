// LB-08: fail-closed classifier for a *non-executed* staging change set.
// Pure review logic; never communicates with CloudFormation or mutates resources.
const PUBLIC_RESOURCE_IDS=new Set([
 'BookingApi','BookingApiApiGatewayDefaultStage','BookingFunction',
 'BookingFunctionRole','BookingFunctionProxyPermission','BookingTable',
 'CalendarMonitorFunction','CalendarMonitorFunctionRole',
 'CalendarMonitorCheckpointTable','CalendarMonitorAlertTopic',
 'CalendarMonitorEmailSubscription','CalendarMonitorFailureAlarm',
 'CalendarMonitorFunctionEveryFourHours',
 'CalendarMonitorFunctionEveryFourHoursPermission'
]);
const READ_ONLY_MANAGEMENT_IDS=new Set([
 'ManagementApi','ManagementApiApiGatewayDefaultStage',
 'ManagementReadOnlyFunction','ManagementReadOnlyFunctionRole',
 'ManagementReadOnlyFunctionGetBookingAdminPermission'
]);
export function inspectManagementPreviewChangeSet({status,executionStatus,changes}={}){
 const blockers=[],review=[];
 if(status!=='CREATE_COMPLETE'||executionStatus!=='AVAILABLE')
  blockers.push('Change set is not an available, unexecuted preview');
 if(!Array.isArray(changes)||changes.length===0)
  blockers.push('No resource changes available for review');
 for(const [i,change] of (Array.isArray(changes)?changes:[]).entries()){
  const resource=change?.ResourceChange;
  if(!resource||!['Add','Modify','Remove','Import','Dynamic'].includes(resource.Action)){
   blockers.push('Unrecognised resource action at item '+i);continue;
  }
  const {LogicalResourceId:id,Action:action,Replacement:replacement,ResourceType:type}=resource;
  if(typeof id!=='string'||!id||typeof type!=='string'||!type){
   blockers.push('Missing resource identity at item '+i);continue;
  }
  review.push({id,action,replacement:replacement??null,type});
  if(replacement==='True'||replacement==='Conditional')
   blockers.push('Resource replacement risk: '+id);
  if(action==='Remove'||action==='Import'||action==='Dynamic')
   blockers.push('Disallowed resource action: '+id+' '+action);
  if(id==='BookingTable')
   blockers.push('BookingTable changed; stop and inspect index preservation manually');
  if(PUBLIC_RESOURCE_IDS.has(id))
   blockers.push('Existing public or monitoring resource changed: '+id);
  if(!READ_ONLY_MANAGEMENT_IDS.has(id))
   blockers.push('Unexpected resource in read-only management preview: '+id);
  if(action!=='Add')
   blockers.push('Expected only new management resources: '+id);
 }
 return {clearedForManualReview:blockers.length===0,blockers,review};
}
