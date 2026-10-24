// Shared booking-master configuration repository.
// Uses the SAME BOOKINGS_TABLE as BOOKING# metadata and UNIT# date slots.
// These functions are intentionally not exposed as public HTTP handlers.
import {GetCommand,PutCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
const KIND=['pricing','stay-rules','cancellation','payments','business','arrival-departure','terms'];
const UNIT=['geranium','honeysuckle','all'];
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export function configKey(kind,unit='all'){
  if(!KIND.includes(kind)||!UNIT.includes(unit))throw Error('Unknown booking configuration');
  return {PK:'CONFIG#'+kind+'#'+unit,SK:'CURRENT'};
}
export function validateConfig({kind,unit='all',value}){
  configKey(kind,unit);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Settings must be an object');
  if(JSON.stringify(value).length>20000)throw Error('Configuration too large');
  if(kind==='pricing'){
    if(unit==='all')throw Error('Pricing must be cottage-specific');
    if(!Array.isArray(value.ranges)||!value.ranges.length)throw Error('Pricing ranges required');
    for(const x of value.ranges)if(!ISO.test(x.from)||!ISO.test(x.to)||x.from>x.to||!Number.isInteger(x.nightlyGBP)||x.nightlyGBP<=0||x.nightlyGBP>10000)throw Error('Invalid pricing range');
  }
  if(kind==='stay-rules'){
    if(!Array.isArray(value.ranges)||!value.ranges.length)throw Error('Stay restrictions required');
    for(const x of value.ranges){
      if(!ISO.test(x.from)||!ISO.test(x.to)||x.from>x.to||!Number.isInteger(x.minNights)||x.minNights<1||x.minNights>27||!Number.isInteger(x.maxNights)||x.maxNights<x.minNights||x.maxNights>27||
      !Array.isArray(x.arrivalWeekdays)||!Array.isArray(x.departureWeekdays)||[...x.arrivalWeekdays,...x.departureWeekdays].some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Invalid stay restriction');
    }
  }
  if(kind==='cancellation'){
    if(!Array.isArray(value.tiers)||!value.tiers.length)throw Error('Refund tiers required');
    for(const x of value.tiers)if(!Number.isInteger(x.daysBeforeArrival)||x.daysBeforeArrival<0||!Number.isInteger(x.refundPercent)||x.refundPercent<0||x.refundPercent>100)throw Error('Invalid refund tier');
  }
  if(kind==='payments'){
    if(!Number.isInteger(value.depositPercent)||value.depositPercent<0||value.depositPercent>100||!Number.isInteger(value.balanceDueDays)||value.balanceDueDays<0)throw Error('Invalid payment policy');
  }
  return true;
}
export async function readSetting(db,table,kind,unit='all'){
  if(!table)throw Error('BOOKINGS_TABLE required');
  const key=configKey(kind,unit);
  return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item??null;
}
export async function listSettingVersions(db,table,kind,unit='all'){
  if(!table)throw Error('BOOKINGS_TABLE required');
  const {PK}=configKey(kind,unit);
  let cursor;const rows=[];
  do{
    const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'PK = :pk AND begins_with(SK,:version)',ExpressionAttributeValues:{':pk':PK,':version':'VERSION#'},ConsistentRead:true,ExclusiveStartKey:cursor}));
    rows.push(...(result.Items??[]));cursor=result.LastEvaluatedKey;
  }while(cursor);
  return rows;
}
// One immutable configuration version per explicitly approved publication.
// Publication CAS prevents racing admin edits; a versioned snapshot remains
// available for pre-existing quotes, accepted bookings and cancellations.
export async function publishSetting(db,table,{kind,unit='all',value,version,expectedVersion=null,actor,approved=false}){
  if(!approved||!actor||typeof actor!=='string')throw Error('Authenticated owner approval required');
  validateConfig({kind,unit,value});
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[A-Za-z0-9_-]{6,40}$/.test(version))throw Error('Invalid version');
  if(!table)throw Error('BOOKINGS_TABLE required');
  const {PK}=configKey(kind,unit),now=new Date().toISOString();
  const current={PK,SK:'CURRENT',kind,unit,version,value,approvedBy:actor,publishedAt:now};
  const historical={...current,SK:'VERSION#'+version};
  // DynamoDB Transaction preserves old settings on any conflict.
  return db.transactPublish({table,current,historical,expectedVersion});
}
