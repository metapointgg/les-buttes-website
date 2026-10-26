// Staging-only internal synthetic booking hold. No HTTP route and no guest input.
// This produces the same reservation shape the existing management PWA reads.
import {randomUUID} from 'node:crypto';
import {quoteFromSnapshots} from './public-quote.mjs';
const DAY=86400000;
export function buildSyntheticHold({availability,pricing,unit,start,end,adults,children,nowEpoch=Math.floor(Date.now()/1000),id=randomUUID()}){
 const quote=quoteFromSnapshots({availability,pricing,unit,start,end,adults,children});
 const nights=Array.from({length:quote.nights},(_,i)=>new Date(Date.parse(start+'T00:00:00Z')+i*DAY).toISOString().slice(0,10));
 const requestedAt=new Date(nowEpoch*1000).toISOString();
 const holdExpiresAt=nowEpoch+24*3600;
 const meta={PK:'BOOKING#'+id,SK:'META',GSI1PK:'BOOKING_REQUESTS',GSI1SK:requestedAt+'#'+id,
  id,unit,units:quote.units.map(x=>x.unit),start,end,guests:adults+children,
  guestName:'Synthetic Staging Guest',guestEmail:'test@example.invalid',notes:'SYNTHETIC STAGING TEST - NO CUSTOMER',
  quote:{status:'STAGING_PUBLISHED_VERIFIED',totalGBP:quote.totalGBP,units:quote.units,
    minimumNights:quote.minimumNights},source:'direct',reservationStatus:'PENDING_REVIEW',
  status:'REQUESTED',requestedAt,holdExpiresAt,expiresAt:nowEpoch+90*86400,synthetic:true};
 const items=[{Put:{Item:meta,ConditionExpression:'attribute_not_exists(PK)'}}];
 for(const unitId of meta.units)for(const date of nights){
  items.push({Put:{Item:{PK:'UNIT#'+unitId,SK:'DATE#'+date,id,expiresAt:holdExpiresAt},
   ConditionExpression:'attribute_not_exists(PK) OR (attribute_exists(expiresAt) AND expiresAt < :now)',
   ExpressionAttributeValues:{':now':nowEpoch}}});
 }
 return {quote,meta,items};
}
export async function submitSyntheticHold({db,table,availability,pricing,unit,start,end,adults,children,nowEpoch,id}){
 if(!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??''))throw Error('Staging table required');
 const hold=buildSyntheticHold({availability,pricing,unit,start,end,adults,children,nowEpoch,id});
 await db.send({TransactItems:hold.items.map(x=>({Put:{...x.Put,TableName:table}})),
  ClientRequestToken:hold.meta.id});
 return {reference:hold.meta.id,totalGBP:hold.quote.totalGBP,expiresAt:hold.meta.holdExpiresAt};
}
