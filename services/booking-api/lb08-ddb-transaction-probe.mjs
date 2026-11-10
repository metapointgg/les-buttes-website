// LB-08 staging-only IAM and transaction API probe.
// The condition is logically impossible: item can neither exist nor not exist.
// This verifies that TransactWriteItems is reachable WITHOUT modifying records.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
export async function probeStagingTransaction({env=process.env,clientFactory}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
   env.LB08_IMPOSSIBLE_TRANSACTION_PROBE!=='yes'||!TABLE.test(env.BOOKINGS_TABLE??''))
  throw Error('Staging-only transaction probe authorisation required');
 const base=clientFactory?null:new DynamoDBClient({region:'eu-west-2'});
 const db=clientFactory?clientFactory():DynamoDBDocumentClient.from(base);
 const key='LB08_PROBE#'+randomUUID();
 try{
  await db.send(new TransactWriteCommand({TransactItems:[{Put:{
   TableName:env.BOOKINGS_TABLE,
   Item:{PK:key,SK:'IMPOSSIBLE_WRITE',kind:'LB08_IMPOSSIBLE_PROBE'},
   ConditionExpression:'attribute_exists(PK) AND attribute_not_exists(PK)'
  }}]}));
  // An impossible conditional write must never succeed; treat this as a critical failure.
  throw Error('CRITICAL: impossible transaction unexpectedly succeeded');
 }catch(error){
  if(error.message?.startsWith('CRITICAL:'))throw error;
  if(error.name==='TransactionCanceledException'&&
    (error.CancellationReasons??[]).some(x=>x.Code==='ConditionalCheckFailed'))
   return {checked:true,region:'eu-west-2',tableName:env.BOOKINGS_TABLE,
    transactionApiAccessible:true,conditionPreventedWrite:true,
    bookingRecordsModified:false,
    note:'No records written; does not verify successful confirmation transaction'};
  if(error.name==='ConditionalCheckFailedException')
   return {checked:true,region:'eu-west-2',tableName:env.BOOKINGS_TABLE,
    transactionApiAccessible:true,conditionPreventedWrite:true,
    bookingRecordsModified:false,
    note:'No records written; does not verify successful confirmation transaction'};
  throw Error('Transaction permission or contract preflight failed: '+(error.name??'UnknownError'));
 }finally{db.destroy?.();base?.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await probeStagingTransaction(),null,2)+'\n');}
 catch(e){process.stderr.write((e.message??'LB-08 probe failed')+'\n');process.exitCode=1;}
}
