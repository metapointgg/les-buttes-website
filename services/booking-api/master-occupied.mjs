// Read-only availability calculation over authoritative DynamoDB UNIT/DATE slots.
// Guest names, booking identifiers, payment data and private calendar URLs are NEVER read.
import {slotBlocksAvailability} from './occupancy.mjs';

export const FIRST_NIGHT='2027-03-20';
export const LAST_NIGHT='2027-10-01';
export const CHECKOUT='2027-10-02';
export const UNITS=['geranium','honeysuckle'];
const oneDay=86400000;
export function nextDay(date){return new Date(Date.parse(date+'T00:00:00.000Z')+oneDay).toISOString().slice(0,10);}

export async function masterOccupied({db,table,nowEpoch=Math.floor(Date.now()/1000),capturedAt=new Date().toISOString()}){
  if(!db||!table)throw Error('Availability master database is not configured');
  const blocked={};
  for(const unit of UNITS){
    const dates=[];let cursor;
    do{
      const result=await db.send({input:{
        TableName:table,ConsistentRead:true,
        KeyConditionExpression:'PK = :unit AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues:{
          ':unit':'UNIT#'+unit,':start':'DATE#'+FIRST_NIGHT,':end':'DATE#'+LAST_NIGHT
        },
        ProjectionExpression:'PK, SK, expiresAt',
        ExclusiveStartKey:cursor
      }});
      for(const row of result.Items??[]){
        if(slotBlocksAvailability(row,nowEpoch)){
          const date=row.SK?.slice(5);
          if(!/^2027-\d{2}-\d{2}$/.test(date)||date<FIRST_NIGHT||date>LAST_NIGHT)throw Error('Unexpected date slot');
          dates.push(date);
        }
      }
      cursor=result.LastEvaluatedKey;
    }while(cursor);
    const ranges=[];
    for(const date of [...new Set(dates)].sort()){
      const last=ranges[ranges.length-1];
      if(last&&last.to===date)last.to=nextDay(date);
      else ranges.push({from:date,to:nextDay(date)});
    }
    blocked[unit]=ranges;
  }
  return {
    mode:'LIVE_STAGING_MASTER_READ_ONLY',capturedAt,firstNight:FIRST_NIGHT,lastNight:LAST_NIGHT,lastCheckout:CHECKOUT,blocked
  };
}
