// Public-safe, token-protected iCalendar generation from the booking master.
// Subscribing an external channel to the feed remains an explicit owner action.
import {createHash} from 'node:crypto';
import {QueryCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {nextDay} from './master-occupied.mjs';
import {slotBlocksAvailability} from './occupancy.mjs';
export async function directCalendarPreview({db,table,unit,now=Math.floor(Date.now()/1000)}){
 if(!['geranium','honeysuckle'].includes(unit)||
    !/^les-buttes-booking-(?:staging|production-data)-BookingTable-[A-Za-z0-9]+$/.test(table??''))
   throw Error('Unsupported booking master');
 const rows=[];let cursor;
 do{const page=await db.send(new QueryCommand({TableName:table,ConsistentRead:true,
  KeyConditionExpression:'PK = :pk AND SK BETWEEN :start AND :end',
  ExpressionAttributeValues:{':pk':'UNIT#'+unit,':start':'DATE#0000-01-01',':end':'DATE#9999-12-31'},ExclusiveStartKey:cursor}));
  rows.push(...page.Items??[]);cursor=page.LastEvaluatedKey;
 }while(cursor);
 const bookings=new Map(),days=[];
 for(const row of rows){
  if(!slotBlocksAvailability(row,now)||typeof row.id!=='string')continue;
  if(!bookings.has(row.id))bookings.set(row.id,(await db.send(new GetCommand({TableName:table,ConsistentRead:true,Key:{PK:'BOOKING#'+row.id,SK:'META'}}))).Item);
  const booking=bookings.get(row.id);
  if(!booking)throw Error('Calendar reservation metadata unavailable');
  if(booking.source!=='direct')continue; // Never echo inbound Airbnb blocks.
  if(!['REQUESTED','APPROVED_AWAITING_PAYMENT','CONFIRMED'].includes(booking.status))continue;
  if(!booking.units?.includes(unit)||!/^DATE#\d{4}-\d{2}-\d{2}$/.test(row.SK)||row.SK.slice(5)<booking.start||row.SK.slice(5)>=booking.end)throw Error('Calendar reservation mismatch');
  if(booking.status!=='CONFIRMED'&&(!Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=now))continue;
  days.push(row.SK.slice(5));
 }
 const unique=[...new Set(days)].sort(),spans=[];
 for(const day of unique){
  const previous=spans.at(-1);
  if(previous&&nextDay(previous.end)===day)previous.end=day;
  else spans.push({start:day,end:day});
 }
 const stamp=new Date(now*1000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Les Buttes//Direct availability//EN',
  'CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Les Buttes '+unit,
  'REFRESH-INTERVAL;VALUE=DURATION:PT15M','X-PUBLISHED-TTL:PT15M'];
 for(const span of spans)lines.push('BEGIN:VEVENT',
  'UID:'+createHash('sha256').update(unit+':'+span.start).digest('hex').slice(0,32)+'@lesbuttes.com',
  'DTSTAMP:'+stamp,'DTSTART;VALUE=DATE:'+span.start.replaceAll('-',''),
  'DTEND;VALUE=DATE:'+nextDay(span.end).replaceAll('-',''),'SUMMARY:Unavailable',
  'DESCRIPTION:Unavailable','TRANSP:OPAQUE','STATUS:CONFIRMED','END:VEVENT');
 lines.push('END:VCALENDAR');
 return {unit,mode:'READ_ONLY_ICAL_FEED',feedReady:true,externalSubscriptionActivated:false,
  reservedNights:unique.length,calendar:lines.join('\r\n')+'\r\n'};
}
