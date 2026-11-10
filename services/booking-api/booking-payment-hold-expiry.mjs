// Staging scheduler transition for approved bookings whose payment hold expired.
// Releases every cottage-night, records one audit event and never infers payment state.
import {randomUUID} from 'node:crypto';
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';

const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export async function expireApprovedPaymentHold({db,table,booking,nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||!TABLE.test(table??'')||!booking||!ID.test(booking.id??'')||
  !Number.isSafeInteger(nowEpoch)||nowEpoch<0)throw Error('Staging hold expiry is not configured');
 if(booking.source!=='direct'||booking.synthetic!==true||booking.guestEmail!=='test@example.invalid'||
  booking.status!=='APPROVED_AWAITING_PAYMENT'||booking.reservationStatus!=='AWAITING_PAYMENT'||
  !Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt>nowEpoch)
  throw Error('Expired synthetic payment hold required');
 if(!Array.isArray(booking.units)||booking.units.length<1||booking.units.length>2||
  new Set(booking.units).size!==booking.units.length||
  booking.units.some(unit=>!['geranium','honeysuckle'].includes(unit)))throw Error('Invalid cottage allocation');
 const start=Date.parse(booking.start+'T00:00:00.000Z'),end=Date.parse(booking.end+'T00:00:00.000Z');
 const nights=(end-start)/86400000;
 if(!Number.isInteger(nights)||nights<1||nights>27||
  new Date(start).toISOString().slice(0,10)!==booking.start||
  new Date(end).toISOString().slice(0,10)!==booking.end)throw Error('Invalid booking dates');
 const slots=booking.units.flatMap(unit=>Array.from({length:nights},(_,index)=>({
  PK:'UNIT#'+unit,SK:'DATE#'+new Date(start+index*86400000).toISOString().slice(0,10)
 })));
 const stamp=new Date(nowEpoch*1000).toISOString(),auditId=randomUUID();
 const items=[{Update:{TableName:table,Key:{PK:'BOOKING#'+booking.id,SK:'META'},
  UpdateExpression:'SET #status=:expired, reservationStatus=:expired, updatedAt=:at, expiredAt=:at, lastManagementActor=:actor, lastManagementAction=:action, expiresAt=:retention',
  ConditionExpression:'#status=:awaiting AND reservationStatus=:reservation AND holdExpiresAt=:observed AND holdExpiresAt<=:now AND id=:id',
  ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':expired':'EXPIRED',
   ':awaiting':'APPROVED_AWAITING_PAYMENT',':reservation':'AWAITING_PAYMENT',
   ':observed':booking.holdExpiresAt,':now':nowEpoch,':id':booking.id,':at':stamp,
   ':actor':'system:staging-payment-expiry',':action':'expire_payment_hold',
   ':retention':nowEpoch+90*86400}}}];
 for(const key of slots)items.push({Delete:{TableName:table,Key:key,
  ConditionExpression:'attribute_not_exists(PK) OR id=:id',ExpressionAttributeValues:{':id':booking.id}}});
 items.push({Put:{TableName:table,Item:{PK:'BOOKING#'+booking.id,SK:'AUDIT#'+stamp+'#'+auditId,
  id:auditId,bookingId:booking.id,action:'payment_hold_expired',from:'APPROVED_AWAITING_PAYMENT',
  to:'EXPIRED',actor:'system:staging-payment-expiry',recordedAt:stamp},
  ConditionExpression:'attribute_not_exists(PK)'}});
 try{
  await db.send(new TransactWriteCommand({TransactItems:items,ClientRequestToken:auditId}));
 }catch(error){
  try{
   const observed=(await db.send(new GetCommand({TableName:table,
    Key:{PK:'BOOKING#'+booking.id,SK:'META'},ConsistentRead:true}))).Item;
   if(observed?.status==='EXPIRED'&&observed.reservationStatus==='EXPIRED')
    return {status:'ALREADY_EXPIRED',bookingId:booking.id,affectedNights:slots.length};
  }catch{/* retain the original uncertain transaction error */}
  throw error;
 }
 return {status:'EXPIRED',bookingId:booking.id,affectedNights:slots.length,auditId};
}
