import {randomUUID} from 'node:crypto';
import {GetCommand,PutCommand} from '@aws-sdk/lib-dynamodb';
export const airbnbKey=unit=>({PK:'UNIT#'+unit,SK:'AIRBNB#CURRENT'});
const validUnit=u=>['geranium','honeysuckle'].includes(u);
export function validateAirbnbSnapshot(row,{unit,start,end,now=Math.floor(Date.now()/1000)}={}){
 if(!validUnit(unit)||row?.source!=='airbnb-calendar'||row.status!=='VERIFIED'||
    typeof row.version!=='string'||!Number.isSafeInteger(row.validUntil)||row.validUntil<=now||
    !Number.isSafeInteger(row.checkedAt)||row.checkedAt>now+60||row.checkedAt<now-1800||
    row.PK!=='UNIT#'+unit||row.SK!=='AIRBNB#CURRENT'||!/^\d{4}-\d{2}-\d{2}$/.test(row.from??'')||!/^\d{4}-\d{2}-\d{2}$/.test(row.to??'')||row.from>start||row.to<end||!Array.isArray(row.blockedNights)||
    row.blockedNights.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)))throw Error('Airbnb availability unverified');
 return row;
}
export async function requireAirbnbAvailability({db,table,units,start,end,now=Math.floor(Date.now()/1000)}){
 const checks=[];
 for(const unit of units){
  const {Item}=await db.send(new GetCommand({TableName:table,Key:airbnbKey(unit),ConsistentRead:true}));
  const row=validateAirbnbSnapshot(Item,{unit,start,end,now});
  if(row.blockedNights.some(d=>d>=start&&d<end))throw Error('Airbnb dates unavailable');
  checks.push({ConditionCheck:{TableName:table,Key:airbnbKey(unit),
   ConditionExpression:'#version = :version AND #status = :verified AND validUntil > :now',
   ExpressionAttributeNames:{'#version':'version','#status':'status'},
   ExpressionAttributeValues:{':version':row.version,':verified':'VERIFIED',':now':now}}});
 }
 return checks;
}
export async function saveAirbnbSnapshot({db,table,unit,blockedNights,from,to,startedAt,verified=true}){
 if(!validUnit(unit)||!Number.isSafeInteger(startedAt))throw Error('Invalid calendar snapshot');
 const Item={...airbnbKey(unit),source:'airbnb-calendar',status:verified?'VERIFIED':'UNVERIFIED',
  version:randomUUID(),checkedAt:startedAt,validUntil:verified?startedAt+1800:0,from,to,
  blockedNights:verified?[...new Set(blockedNights)].filter(d=>d>=from&&d<to).sort():[]};
 // An older invocation must never replace a newer observed calendar.
 await db.send(new PutCommand({TableName:table,Item,
  ConditionExpression:'attribute_not_exists(checkedAt) OR checkedAt < :started',
  ExpressionAttributeValues:{':started':startedAt}}));
 return Item;
}
