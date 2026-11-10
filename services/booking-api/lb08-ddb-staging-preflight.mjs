// LB-08: operator-triggered read-only inspection of actual staging DynamoDB table.
// No PutItem, UpdateItem, TransactWriteItems, or test booking mutation.
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
export async function inspectStagingBookingTable({env=process.env,clientFactory}={}){
 if(env.AWS_REGION!=='eu-west-2'||env.BOOKING_ENVIRONMENT!=='staging'||
    env.LB08_READONLY_DDB_PREFLIGHT!=='yes'||!TABLE.test(env.BOOKINGS_TABLE??''))
  throw Error('Explicit isolated staging table preflight authorisation required');
 const db=clientFactory?clientFactory():new DynamoDBClient({region:'eu-west-2'});
 try{
  const result=await db.send(new DescribeTableCommand({TableName:env.BOOKINGS_TABLE}));
  const table=result.Table;
  if(!table||table.TableName!==env.BOOKINGS_TABLE||table.TableStatus!=='ACTIVE')
   throw Error('Staging booking table is not active');
  const keys=table.KeySchema??[];
  if(keys.length!==2||!keys.some(k=>k.AttributeName==='PK'&&k.KeyType==='HASH')||
     !keys.some(k=>k.AttributeName==='SK'&&k.KeyType==='RANGE'))
   throw Error('Staging booking table key schema mismatch');
  const arn=table.TableArn??'';
  if(!arn.startsWith('arn:aws:dynamodb:eu-west-2:')||
     !arn.endsWith(':table/'+env.BOOKINGS_TABLE))
   throw Error('Unexpected staging table ARN');
  return {ready:true,region:'eu-west-2',tableName:table.TableName,
   status:table.TableStatus,partitionKey:'PK',sortKey:'SK',
   note:'Read-only table schema validated; write permission and transactions NOT tested'};
 }finally{db.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await inspectStagingBookingTable(),null,2)+'\n');}
 catch{process.stderr.write('LB-08 staging DynamoDB schema preflight failed; verify table name, AWS permissions and PK/SK schema.\n');process.exitCode=1;}
}
