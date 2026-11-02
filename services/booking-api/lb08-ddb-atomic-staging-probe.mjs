// LB-08: explicit, staging-only DynamoDB atomic transaction exercise.
// Test keys are not used by any booking, availability or payment lookup.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
export async function probeAtomicStagingTransaction({env=process.env,clientFactory,uuid=randomUUID}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.LB08_ATOMIC_SYNTHETIC_WRITE!=='yes'||!TABLE.test(env.BOOKINGS_TABLE??''))
  throw Error('Explicit staging synthetic atomic write authorisation required');
 const runId=uuid();
 if(!/^[0-9a-f-]{36}$/i.test(runId))throw Error('Invalid synthetic run ID');
 const base=clientFactory?null:new DynamoDBClient({region:'eu-west-2'});
 const db=clientFactory?clientFactory():DynamoDBDocumentClient.from(base);
 const pk='LB08_SYNTHETIC_TRANSACTION#'+runId;
 const keys=[{PK:pk,SK:'ATOMIC#A'},{PK:pk,SK:'ATOMIC#B'}];
 const now=Math.floor(Date.now()/1000);
 const puts=keys.map(key=>({Put:{TableName:env.BOOKINGS_TABLE,
  Item:{...key,kind:'LB08_ATOMIC_PROBE',runId,expiresAt:now+3600},
  ConditionExpression:'attribute_not_exists(PK)'}}));
 let committed=false,cleaned=false;
 try{
  await db.send(new TransactWriteCommand({TransactItems:puts}));
  committed=true;
  const read=await Promise.all(keys.map(Key=>db.send(new GetCommand({
   TableName:env.BOOKINGS_TABLE,Key,ConsistentRead:true}))));
  if(read.some(x=>x.Item?.runId!==runId||x.Item?.kind!=='LB08_ATOMIC_PROBE'))
   throw Error('Atomic transaction readback mismatch');
  let replayRejected=false;
  try{await db.send(new TransactWriteCommand({TransactItems:puts}));}
  catch(error){
   replayRejected=error.name==='TransactionCanceledException'&&
    (error.CancellationReasons??[]).some(r=>r.Code==='ConditionalCheckFailed');
   if(!replayRejected)throw error;
  }
  if(!replayRejected)throw Error('CRITICAL: duplicate transaction was accepted');
  return {passed:true,region:'eu-west-2',tableName:env.BOOKINGS_TABLE,
   syntheticRecordsWritten:2,stronglyConsistentReadback:true,
   duplicateTransactionRejected:true,runId,
   note:'Synthetic diagnostic transaction only; not a booking-confirmation integration test'};
 }finally{
  try{
   if(committed){
    const deletes=keys.map(Key=>({Delete:{TableName:env.BOOKINGS_TABLE,Key,
     ConditionExpression:'runId = :run',ExpressionAttributeValues:{':run':runId}}}));
    await db.send(new TransactWriteCommand({TransactItems:deletes}));
    cleaned=true;
   }
  }finally{
   db.destroy?.();base?.destroy?.();
  }
  // A cleanup failure propagates, rather than claiming success with residual records.
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await probeAtomicStagingTransaction(),null,2)+'\n');}
 catch(e){process.stderr.write('LB-08 atomic staging test failed: '+(e.name??'Error')+' '+(e.message??'')+'\n');process.exitCode=1;}
}
