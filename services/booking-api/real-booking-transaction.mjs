// Pure staging transaction planner. No AWS writes, HTTP endpoint or live guest submission.
// Re-checking a snapshot is not a lock: conditional UNIT#... DATE#... writes are the lock.
import {quoteFromSnapshots} from './public-quote.mjs';
import {buildEncryptedRealBookingItems} from './real-booking-storage.mjs';

const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const DAY=86400000;
const datesBetween=(start,nights)=>Array.from({length:nights},(_,i)=>
 new Date(Date.parse(start+'T00:00:00Z')+i*DAY).toISOString().slice(0,10));

export async function planRealBookingTransaction({
 prepared,availability,pricing,encrypt,tableName,nowEpoch=Math.floor(Date.now()/1000),
 contactRetentionDays=90,holdHours=24
}){
 if(process.env.BOOKING_ENVIRONMENT!=='staging' || !TABLE.test(tableName??''))
  throw Error('Staging booking master required');
 if(process.env.BOOKING_REAL_GUEST_WRITES==='true')
  throw Error('Real guest writes must remain disabled for dry-run planning');
 if(!prepared || prepared.publicMetadata?.synthetic!==false ||
    prepared.encryptionContext?.bookingId!==prepared.reference)
  throw Error('Invalid real booking preparation');
 if(!Number.isSafeInteger(nowEpoch)||nowEpoch<0 || !Number.isInteger(contactRetentionDays) ||
    contactRetentionDays<1||contactRetentionDays>365||holdHours!==24)
  throw Error('Invalid retention or hold period');
 const meta=prepared.publicMetadata;
 const quote=quoteFromSnapshots({availability,pricing,unit:meta.unit,start:meta.start,
  end:meta.end,adults:meta.adults,children:meta.children});
 if(quote.units.length!==meta.units.length ||
    quote.units.some(x=>!meta.units.includes(x.unit)))throw Error('Cottage selection mismatch');
 const holdExpiresAt=nowEpoch+holdHours*3600;
 const retentionEpoch=nowEpoch+contactRetentionDays*86400;
 const records=await buildEncryptedRealBookingItems({
  prepared,encrypt,tableName,retentionEpoch
 });
 const dates=datesBetween(meta.start,quote.nights);
 const booking=records[0].Put.Item;
 booking.GSI1PK='BOOKING_REQUESTS';
 booking.GSI1SK=meta.requestedAt+'#'+prepared.reference;
 booking.quote={status:'STAGING_PUBLISHED_VERIFIED',totalGBP:quote.totalGBP,units:quote.units,
  minimumNights:quote.minimumNights};
 booking.reservationStatus='PENDING_REVIEW';
 booking.holdExpiresAt=holdExpiresAt;
 booking.expiresAt=retentionEpoch;
 const slots=[];
 for(const unit of meta.units)for(const date of dates)slots.push({Put:{
  TableName:tableName,Item:{PK:'UNIT#'+unit,SK:'DATE#'+date,id:prepared.reference,expiresAt:holdExpiresAt},
  ConditionExpression:'attribute_not_exists(PK) OR (attribute_exists(expiresAt) AND expiresAt < :now)',
  ExpressionAttributeValues:{':now':nowEpoch}
 }});
 const items=[...records,...slots];
 if(items.length>100)throw Error('DynamoDB transaction item limit exceeded');
 return Object.freeze({
  mode:'DRY_RUN_ONLY',reference:prepared.reference,totalGBP:quote.totalGBP,
  slotCount:slots.length,holdExpiresAt,
  // Never return these from an HTTP handler or log them: includes encrypted guest ciphertext.
  transactWrite:{TransactItems:items,ClientRequestToken:prepared.reference}
 });
}
