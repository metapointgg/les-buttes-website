// Private scheduled staging-only Lambda. Reads Airbnb exports and the master booking table.
// NEVER writes to booking-table rows, auto-imports or cancels reservations.
// The two Airbnb bearer URLs exist only in SSM SecureString parameters.
import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {SNSClient,PublishCommand} from '@aws-sdk/client-sns';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,BatchGetCommand,GetCommand,PutCommand} from '@aws-sdk/lib-dynamodb';
import {parseAirbnbCalendar} from './preview-airbnb.mjs';
import {compareAirbnbBlocks} from './reconcile-logic.mjs';
import {validateAirbnbUrl,assessMonitorRun,monitorMessage} from './monitor-logic.mjs';

const ssm=new SSMClient({});
const sns=new SNSClient({});
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const {BOOKING_ENVIRONMENT,BOOKINGS_TABLE,MONITOR_STATE_TABLE,MONITOR_SNS_TOPIC_ARN,MONITOR_FROM_DATE,MONITOR_TO_DATE}=process.env;
const units=[
  {unit:'geranium',param:process.env.MONITOR_GERANIUM_SSM},
  {unit:'honeysuckle',param:process.env.MONITOR_HONEYSUCKLE_SSM}
];
function guard(){
  if(BOOKING_ENVIRONMENT!=='staging'||!BOOKINGS_TABLE?.toLowerCase().includes('staging')||
     !MONITOR_STATE_TABLE?.toLowerCase().includes('staging')||
     !MONITOR_SNS_TOPIC_ARN||!MONITOR_FROM_DATE||!MONITOR_TO_DATE||
     units.some(v=>!v.param?.startsWith('/les-buttes/booking/staging/airbnb/')))
    throw Error('Staging calendar monitor is not configured safely');
}
async function getState(unit){
  const r=await db.send(new GetCommand({TableName:MONITOR_STATE_TABLE,Key:{PK:'UNIT#'+unit},ConsistentRead:true}));
  return r.Item;
}
async function saveState(unit,state){
  await db.send(new PutCommand({TableName:MONITOR_STATE_TABLE,Item:{PK:'UNIT#'+unit,...state}}));
}
async function publish(subject,message){
  // Only dates/exception counts: no full feed, Airbnb secret URL, guest name or contact details.
  await sns.send(new PublishCommand({TopicArn:MONITOR_SNS_TOPIC_ARN,Subject:subject.slice(0,95),Message:message}));
}
async function getCalendarText(entry){
  const r=await ssm.send(new GetParameterCommand({Name:entry.param,WithDecryption:true}));
  const url=validateAirbnbUrl(r.Parameter?.Value,entry.unit);
  const response=await fetch(url,{redirect:'error',headers:{Accept:'text/calendar'},signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)throw Error('Calendar unavailable');
  if(Number(response.headers.get('content-length')||0)>5_000_000)throw Error('Calendar too large');
  const chunks=[];let length=0;
  for await(const chunk of response.body){
    length+=chunk.length;
    if(length>5_000_000)throw Error('Calendar too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function getSlots(unit){
  const rows=[];let cursor;
  do{
    const r=await db.send(new QueryCommand({
      TableName:BOOKINGS_TABLE,
      KeyConditionExpression:'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues:{':pk':'UNIT#'+unit,':from':'DATE#'+MONITOR_FROM_DATE,':to':'DATE#'+MONITOR_TO_DATE},
      ExclusiveStartKey:cursor,ConsistentRead:true
    }));
    rows.push(...r.Items??[]);cursor=r.LastEvaluatedKey;
  }while(cursor);
  return rows;
}
async function getMetadata(rows){
  const ids=[...new Set(rows.map(x=>x.id).filter(x=>typeof x==='string'&&x.length>0))];
  const metadata=new Map();
  for(let i=0;i<ids.length;i+=100){
    let pending=ids.slice(i,i+100).map(id=>({PK:'BOOKING#'+id,SK:'META'}));
    for(let attempt=0;pending.length&&attempt<5;attempt++){
      const r=await db.send(new BatchGetCommand({RequestItems:{[BOOKINGS_TABLE]:{Keys:pending,ConsistentRead:true}}}));
      for(const x of r.Responses?.[BOOKINGS_TABLE]??[])metadata.set(x.id,x);
      pending=r.UnprocessedKeys?.[BOOKINGS_TABLE]?.Keys??[];
    }
    if(pending.length)throw Error('Master metadata not fully readable');
  }
  return metadata;
}
async function inspect(entry){
  const previous=await getState(entry.unit);
  try{
    const feed=parseAirbnbCalendar(await getCalendarText(entry));
    const rows=await getSlots(entry.unit);
    const metadata=await getMetadata(rows);
    const audit=compareAirbnbBlocks(feed.blockedNights,rows,metadata,{
      from:MONITOR_FROM_DATE,to:MONITOR_TO_DATE
    });
    const report=assessMonitorRun(feed.blockedNights,previous,audit,{
      from:MONITOR_FROM_DATE,to:MONITOR_TO_DATE
    });
    if(report.shouldAlert){
      const message=monitorMessage(entry.unit,report,MONITOR_FROM_DATE,MONITOR_TO_DATE);
      await publish('Les Buttes staging Airbnb calendar REVIEW: '+entry.unit,message);
      console.info('Calendar review alert published:',entry.unit);
    }
    await saveState(entry.unit,{
      blockedNights:report.current,issueFingerprint:report.issueFingerprint,
      checkedAt:new Date().toISOString(),errorNotified:false
    });
    console.info('Calendar monitor completed:',entry.unit,'feed nights',audit.feedNightCount,
      'master nights',audit.masterNightCount,'review required',report.shouldAlert,
      'baseline',report.isBaseline);
    return {unit:entry.unit,checked:true,reviewRequired:report.shouldAlert,baseline:report.isBaseline};
  }catch(e){
    // Do not log e.message: third-party/network SDK errors may contain secret URLs.
    console.error('Airbnb calendar monitor failed for:',entry.unit,'type:',e.name||'Error');
    if(!previous?.errorNotified){
      await publish('Les Buttes staging Airbnb MONITOR FAILED: '+entry.unit,
        'Automatic calendar check failed for '+entry.unit+'. No booking dates were changed.\n'+
        'The feed, configuration or staging master needs manual investigation.\n'+
        'Check AWS CloudWatch logs for the calendar monitor. Do not assume the calendar is current.');
      await saveState(entry.unit,{...previous,errorNotified:true,lastErrorAt:new Date().toISOString()});
    }
    return {unit:entry.unit,checked:false,reviewRequired:true};
  }
}
export async function handler(){
  guard();
  const results=[];
  for(const entry of units)results.push(await inspect(entry));
  if(results.some(r=>!r.checked))throw Error('One or more Airbnb calendar checks failed');
  return {ok:true,results};
}
