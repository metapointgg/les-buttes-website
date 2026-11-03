// LB-08 staging stack preflight for preparing (never executing) a change set.
// Do not trust template defaults for the booking index: the deployed stack may
// predate these parameters while already containing BookingRequestsIndex.
import {CloudFormationClient,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
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
export async function inspectStagingChangeSetPreflight({env=process.env,
 cfn=new CloudFormationClient({region:'eu-west-2'}),
 ddb=new DynamoDBClient({region:'eu-west-2'}),
 proposed}={}){
 if(env.AWS_REGION!=='eu-west-2'||env.BOOKING_ENVIRONMENT!=='staging'||
    env.LB08_STACK_READONLY_PREFLIGHT!=='yes')
  throw Error('Read-only staging stack inspection requires explicit opt-in');
 const [stackResponse,tableResponse]=await Promise.all([
  cfn.send(new DescribeStacksCommand({StackName:STACK})),
  ddb.send(new DescribeTableCommand({TableName:TABLE}))
 ]);
 const stack=stackResponse.Stacks?.[0],table=tableResponse.Table;
 // The account must be supplied by the caller from a verified STS identity.
 return verifyStagingChangeSetPreflight({account:env.AWS_ACCOUNT_ID,
  stack,table,proposed});
}
