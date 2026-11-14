import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {prepareConfirmedGuestEmail} from './booking-confirmation-email-preparation.mjs';
import {prepareRequestedBookingEmails} from './booking-request-email-preparation.mjs';
import {renderBookingLifecycleEmail} from './booking-lifecycle-email-templates.mjs';
import {sendProductionBookingEmailOnce} from './booking-production-email-outbox.mjs';
import {productionEmailGate} from './production-integration-gates.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed=(env,table,flag)=>productionEmailGate(env)&&TABLE.test(table??'')&&env[flag]==='true';

export async function dispatchRequestedProductionBookingEmails({db,table,bookingId,transport,
 env=process.env,send=sendProductionBookingEmailOnce}={}){
 if(!db?.send||!transport?.send||!ID.test(bookingId??'')||
  !allowed(env,table,'BOOKING_REQUEST_DISPATCH_ENABLED'))throw Error('Production request dispatch disabled');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(booking?.id!==bookingId||booking.synthetic===true)throw Error('Authoritative production booking unavailable');
 const messages=prepareRequestedBookingEmails(booking,{ownerEmail:env.BOOKING_OWNER_EMAIL});
 const results=[];
 for(const message of messages)results.push(await send({db,table,transport,env,message}));
 return results;
}

export async function dispatchProductionBookingLifecycleEmail({db,table,bookingId,type,transport,
 env=process.env,send=sendProductionBookingEmailOnce,reminderStage}={}){
 if(!db?.send||!transport?.send||!ID.test(bookingId??'')||
  !allowed(env,table,'BOOKING_LIFECYCLE_DISPATCH_ENABLED')||
  !['approval_payment','balance_reminder','declined','cancelled','confirmed','refund_confirmed','hold_expired'].includes(type))
  throw Error('Production lifecycle dispatch disabled');
 const {Item:booking}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}));
 if(booking?.id!==bookingId||booking.source!=='direct'||booking.synthetic===true)
  throw Error('Authoritative production booking unavailable');
 let message;
 if(type==='confirmed')message=prepareConfirmedGuestEmail(booking);
 else{
  if(!Array.isArray(booking.units)||!booking.units.length||booking.units.length>2||
   new Set(booking.units).size!==booking.units.length||booking.units.some(u=>!['geranium','honeysuckle'].includes(u)))
   throw Error('Invalid booking cottages');
  const cottage=booking.units.length===2?'Geranium and Honeysuckle':booking.units[0]==='geranium'?'Geranium':'Honeysuckle';
  let checkout;
  if(type==='approval_payment'||type==='balance_reminder'){
   checkout=(await db.send(new GetCommand({TableName:table,
    Key:{PK:'BOOKING#'+bookingId,SK:type==='balance_reminder'?'PAYMENT#BALANCE_CHECKOUT':'PAYMENT#CHECKOUT'},ConsistentRead:true}))).Item;
   if(type==='approval_payment'&&(!Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=Math.floor(Date.now()/1000)))
    throw Error('Expired payment request');
  }
  message=renderBookingLifecycleEmail({type,booking:{bookingId,cottage,checkIn:booking.start,
   checkOut:booking.end,status:booking.status,approvedAmountPence:Math.round(Number(booking.approvedAmountGBP)*100),
   guestName:booking.guestName,
   balancePence:type==='balance_reminder'?booking.balanceDuePence:booking.paymentSchedule?.balancePence,
   balanceDueDate:booking.paymentSchedule?.dueDate,
   refundStatus:booking.refundStatus,refundedAmountPence:booking.refundedAmountPence},checkout,reminderStage});
 }
 return send({db,table,transport,env,message:{...message,to:booking.guestEmail}});
}
