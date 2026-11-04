// LB-08 isolated read-only management CREATE change-set review.
// The reviewer accepts only additions in the dedicated isolated stack.
// Template contents, JWT settings and IAM policy remain subject to manual review.
const allowed={
 ManagementPreviewApi:new Set(['AWS::ApiGatewayV2::Api','AWS::ApiGatewayV2::Stage',
  'AWS::ApiGatewayV2::Authorizer','AWS::ApiGatewayV2::Route','AWS::ApiGatewayV2::Integration']),
 ManagementPreviewReadFunction:new Set(['AWS::Lambda::Function','AWS::Lambda::Permission','AWS::IAM::Role'])
};
export function inspectIsolatedManagementChangeSet({status,executionStatus,changes}={}){
 const blockers=[],review=[];
 if(status!=='CREATE_COMPLETE'||executionStatus!=='AVAILABLE')
  blockers.push('CREATE-only change set is not available for manual review');
 if(!Array.isArray(changes)||changes.length===0)
  blockers.push('Change set contains no resource changes');
 for(const item of Array.isArray(changes)?changes:[]){
  const resource=item?.ResourceChange,id=resource?.LogicalResourceId,
   type=resource?.ResourceType,action=resource?.Action,replacement=resource?.Replacement;
  if(typeof id!=='string'||typeof type!=='string'||action!=='Add'||
     (replacement!==undefined&&replacement!=='False'&&replacement!=='Never')){
   blockers.push('Non-addition or unexpected replacement in isolated preview');continue;
  }
  const owner=Object.keys(allowed).find(prefix=>id.startsWith(prefix));
  if(!owner||!allowed[owner].has(type))
   blockers.push('Unexpected resource in isolated management preview: '+id);
  review.push({id,type,action,replacement:replacement??null});
 }
 const ids=new Set(review.map(x=>x.id));
 if(!ids.has('ManagementPreviewApi')||!ids.has('ManagementPreviewReadFunction'))
  blockers.push('Read-only API or Lambda absent');
 return {clearedForManualReview:blockers.length===0,blockers,review};
}
