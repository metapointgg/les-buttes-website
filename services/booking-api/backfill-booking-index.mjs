// ONE-TIME staging-only migration: index existing direct BOOKING#.../META rows
// in the SAME DynamoDB master. Dry-run by default. Does not touch UNIT# slots,
// statuses, quotes, payments or guest contact fields.
import {fileURLToPath} from 'node:url';
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,ScanCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';

const STAGING_TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const BOOKING_ID=/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
export function indexKey(row){
  if(!row||row.SK!=='META'||row.source!=='direct'||
      !BOOKING_ID.test(row.id??'')||row.PK!=='BOOKING#'+row.id||
      typeof row.requestedAt!=='string'||!TIME.test(row.requestedAt)||
      !Number.isFinite(Date.parse(row.requestedAt)))return null;
  if(row.GSI1PK||row.GSI1SK)return null; // already indexed; never overwrite
  return {pk:'BOOKING_REQUESTS',sk:row.requestedAt+'#'+row.id};
}
export function indexUpdate(table,row,key){
  return {
    TableName:table,Key:{PK:row.PK,SK:'META'},
    UpdateExpression:'SET GSI1PK = :gsiPk, GSI1SK = :gsiSk',
    ConditionExpression:'attribute_not_exists(GSI1PK) AND attribute_not_exists(GSI1SK) AND #src = :source AND #requestedAt = :requested AND #id = :id',
    ExpressionAttributeNames:{'#src':'source','#requestedAt':'requestedAt','#id':'id'},
    ExpressionAttributeValues:{':gsiPk':key.pk,':gsiSk':key.sk,':source':'direct',':requested':row.requestedAt,':id':row.id}
  };
}
export async function run({db,table,apply=false,maxRows=5000,log=console.log}){
  if(process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.AWS_REGION!=='eu-west-2'||
      !STAGING_TABLE.test(table))throw Error('Refusing non-staging table or region');
  let count=0,skipped=0,updated=0,cursor,pages=0;
  do{
    if(++pages>500)throw Error('Backfill page safety limit reached');
    const result=await db.send(new ScanCommand({
      TableName:table,ConsistentRead:true,Limit:100,ExclusiveStartKey:cursor,
      FilterExpression:'begins_with(#pk,:booking) AND #sk = :meta',
      ProjectionExpression:'#pk,#sk,#id,#src,#requestedAt,GSI1PK,GSI1SK',
      ExpressionAttributeNames:{'#pk':'PK','#sk':'SK','#id':'id','#src':'source','#requestedAt':'requestedAt'},
      ExpressionAttributeValues:{':booking':'BOOKING#',':meta':'META'}
    }));
    for(const row of result.Items??[]){
      if(++count>maxRows)throw Error('Backfill row safety limit reached');
      const key=indexKey(row);
      if(!key){skipped++;continue;}
      if(apply){
        await db.send(new UpdateCommand(indexUpdate(table,row,key)));
        updated++;
      }else updated++;
    }
    cursor=result.LastEvaluatedKey;
  }while(cursor);
  log(`${apply?'APPLIED':'DRY RUN'}: ${count} booking metadata rows examined, ${updated} eligible, ${skipped} skipped. No UNIT# or other booking attributes changed.`);
  return {count,eligible:updated,skipped,applied:apply};
}
async function main(){
  const table=process.env.BOOKINGS_TABLE;
  const apply=process.argv.includes('--apply');
  if(apply&&(!process.argv.includes('--ack-staging-only')||!process.argv.includes('--ack-metadata-index-only'))){
    throw Error('Apply requires --ack-staging-only --ack-metadata-index-only');
  }
  if(!table||!STAGING_TABLE.test(table)||process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.AWS_REGION!=='eu-west-2'){
    throw Error('Use the existing staging BOOKING_ENVIRONMENT, AWS_REGION and BOOKINGS_TABLE');
  }
  const raw=new DynamoDBClient({region:'eu-west-2'});
  if(apply){
    const description=await raw.send(new DescribeTableCommand({TableName:table}));
    const index=description.Table?.GlobalSecondaryIndexes?.find(x=>x.IndexName==='BookingRequestsIndex');
    if(index?.IndexStatus!=='ACTIVE')throw Error('Staging BookingRequestsIndex must be ACTIVE before --apply');
  }
  const db=DynamoDBDocumentClient.from(raw);
  await run({db,table,apply});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(error=>{console.error('Backfill stopped:',error?.message??'Error');process.exitCode=1;});
}
