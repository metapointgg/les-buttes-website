// READ-ONLY. Compares a locally downloaded Airbnb .ics export with the
// currently held DynamoDB slot records. No remote Airbnb fetch; no writes.
import {readFileSync} from 'node:fs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,BatchGetCommand} from '@aws-sdk/lib-dynamodb';
import {parseAirbnbCalendar} from './preview-airbnb.mjs';
import {compareAirbnbBlocks} from './reconcile-logic.mjs';

const [unit,filename,from,to]=process.argv.slice(2);
if(!['geranium','honeysuckle'].includes(unit)||!filename||!from||!to){
  console.error('Usage: node reconcile-airbnb.mjs geranium|honeysuckle LOCAL_ICS_FILE FROM_DATE TO_DATE_EXCLUSIVE');
  process.exit(2);
}
const table=process.env.BOOKINGS_TABLE;
if(process.env.BOOKING_ENVIRONMENT!=='staging'||!table?.toLowerCase().includes('staging')){
  console.error('This reconciliation preview is currently restricted to an isolated staging table.');
  process.exit(2);
}
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
async function querySlots(){
  const rows=[];let cursor;
  do{
    const r=await db.send(new QueryCommand({
      TableName:table,
      KeyConditionExpression:'PK = :pk AND SK BETWEEN :a AND :b',
      ExpressionAttributeValues:{':pk':'UNIT#'+unit,':a':'DATE#'+from,':b':'DATE#'+to},
      ConsistentRead:true,ExclusiveStartKey:cursor
    }));
    rows.push(...r.Items??[]);cursor=r.LastEvaluatedKey;
  }while(cursor);
  return rows;
}
async function getBookingMetadata(rows){
  const ids=[...new Set(rows.map(r=>r.id).filter(id=>typeof id==='string'&&id.length>0))];
  const metadata=new Map();
  for(let i=0;i<ids.length;i+=100){
    let pending=ids.slice(i,i+100).map(id=>({PK:'BOOKING#'+id,SK:'META'}));
    for(let attempt=0;pending.length&&attempt<5;attempt++){
      const res=await db.send(new BatchGetCommand({RequestItems:{[table]:{Keys:pending,ConsistentRead:true}}}));
      for(const b of res.Responses?.[table]??[])metadata.set(b.id,b);
      pending=res.UnprocessedKeys?.[table]?.Keys??[];
    }
    if(pending.length)throw Error('Unable to verify every master booking record. Comparison aborted.');
  }
  return metadata;
}
function printSpans(label,spans){
  console.log(label+': '+spans.reduce((n,s)=>n+s.nights,0)+' night(s)');
  for(const s of spans)console.log('  '+s.start+' to '+s.end+' (checkout, '+s.nights+' night(s))');
}
try{
  const feed=parseAirbnbCalendar(readFileSync(filename,'utf8'));
  const rows=await querySlots();
  const metadata=await getBookingMetadata(rows);
  const audit=compareAirbnbBlocks(feed.blockedNights,rows,metadata,{from,to});
  console.log('\nREAD-ONLY AIRBNB CALENDAR RECONCILIATION: '+unit);
  console.log('Window: '+from+' to '+to+' (exclusive); Airbnb blocks: '+audit.feedNightCount+' night(s); master blocks: '+audit.masterNightCount+' night(s).');
  printSpans('Matching classified Airbnb dates',audit.alignedAirbnb);
  printSpans('AIRBNB-ONLY: blocked in export but not master (REVIEW BEFORE ADDING)',audit.missingInMaster);
  printSpans('MASTER AIRBNB-ONLY: source Airbnb in master but absent from export (DO NOT AUTO-CANCEL)',audit.missingFromAirbnb);
  printSpans('UNCLASSIFIED master blocks (classify existing record first)',audit.unclassified);
  printSpans('Other-source master dates ALSO in Airbnb export (often expected)',audit.otherOnAirbnb);
  printSpans('Other-source master dates absent from Airbnb export (check outbound sync)',audit.otherOnlyMaster);
  console.log('No records changed. Airbnb exported blocks can include maintenance/blocked availability, and may reflect imports from Les Buttes.');
}catch(error){console.error('Reconciliation aborted: '+error.message);process.exitCode=1;}
