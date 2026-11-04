// Host-only read of staging DATE slots, deliberately excluding ALL guest metadata.
// Produces a timestamped, non-live public-safe calendar reference for LOCAL PR preview.
// Never schedules itself, exposes AWS credentials, or modifies booking records.
// Usage (from repo root): node services/booking-api/export-availability-snapshot.mjs
import {QueryCommand,DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {slotBlocksAvailability} from './occupancy.mjs';

const table=process.env.BOOKINGS_TABLE;
const env=process.env.BOOKING_ENVIRONMENT;
if(env!=='staging'||!table||!table.toLowerCase().includes('staging')){
  throw Error('Refusing export: set BOOKING_ENVIRONMENT=staging and an explicitly named staging BOOKINGS_TABLE');
}
const first='2027-03-20',last='2027-10-01';
const units=['geranium','honeysuckle'];
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const now=Math.floor(Date.now()/1000);
const plusDay=date=>new Date(Date.parse(date+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);

async function occupiedDates(unit){
  const days=[];let cursor;
  do{
    const result=await db.send(new QueryCommand({
      TableName:table,ConsistentRead:true,
      KeyConditionExpression:'PK = :unit AND SK BETWEEN :first AND :last',
      ExpressionAttributeValues:{':unit':'UNIT#'+unit,':first':'DATE#'+first,':last':'DATE#'+last},
      ProjectionExpression:'PK, SK, expiresAt',
      ExclusiveStartKey:cursor
    }));
    for(const slot of result.Items??[]){
      if(slotBlocksAvailability(slot,now)){
        const date=slot.SK?.slice(5);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<first||date>last)
          throw Error('Unexpected occupied slot in '+unit+' at '+String(date));
        days.push(date);
      }
    }
    cursor=result.LastEvaluatedKey;
  }while(cursor);
  const unique=[...new Set(days)].sort();
  const ranges=[];
  for(const date of unique){
    const current=ranges[ranges.length-1];
    if(current&&current.to===date){current.to=plusDay(date);}
    else ranges.push({from:date,to:plusDay(date)});
  }
  return {ranges,occupiedNights:unique.length};
}
const blocked={},counts={};
for(const unit of units){
  const data=await occupiedDates(unit);
  blocked[unit]=data.ranges;
  counts[unit]=data.occupiedNights;
}
if(counts.geranium===0||counts.honeysuckle===0){
  throw Error('Safety: one cottage returned zero occupied nights. Verify table/account before publishing a snapshot.');
}
const output={
  mode:'DATED_REFERENCE_OCCUPANCY_NOT_LIVE',
  capturedAt:new Date().toISOString(),
  source:'Read-only, consistent staging DynamoDB unit-date slot query, filtered with the same non-expired slot rule as the master availability service. No guest identifiers, reference IDs or secrets are exported. This is a dated snapshot, not live availability.',
  firstNight:first,lastNight:last,blocked,
  notice:'A dated snapshot can show known occupied dates, but dates without known blocks are not confirmed available. Always verify the authoritative master and Airbnb calendars immediately before creating a hold.'
};
const path=fileURLToPath(new URL('../../src/data/booking-occupancy-snapshot-2027.json',import.meta.url));
await writeFile(path+'.tmp',JSON.stringify(output,null,2)+'\n','utf8');
await rename(path+'.tmp',path);
console.log('Updated local NON-LIVE booking preview occupancy snapshot: '+path);
console.log('Captured at '+output.capturedAt+'; occupied nights Geranium='+counts.geranium+', Honeysuckle='+counts.honeysuckle);
console.log('No AWS booking records were modified. This file must NOT be treated as real-time bookability.');
