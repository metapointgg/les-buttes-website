// LB-08 host-only staging checkout registration service.
// The owner supplies a booking ID, never the payment amount or checkout URL.
// No public endpoint; deployed handler keeps checkout registration disabled.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {createAndRegisterCheckout} from './sumup-checkout-orchestrator.mjs';
import {productionPaymentsEnabled} from './sumup-production-runtime.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGING_TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
export async function registerApprovedBookingCheckout({db,table,bookingId,identity,
 sumup,orchestrate=createAndRegisterCheckout,
 nowEpoch=Math.floor(Date.now()/1000),env=process.env}={}){
 const environmentAllowed=env.BOOKING_ENVIRONMENT==='staging'&&STAGING_TABLE.test(table??'')||
  productionPaymentsEnabled({...env,BOOKINGS_TABLE:table});
 if(!environmentAllowed||
    !db?.send||typeof orchestrate!=='function'||!sumup||
    identity?.role!=='owner'||typeof identity.subject!=='string'||
    !identity.subject.trim()||!UUID.test(bookingId??'')||
    !Number.isSafeInteger(nowEpoch)||nowEpoch<0)
  throw Error('Checkout registration unavailable');
 const booking=(await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}))).Item;
 if(!booking||booking.id!==bookingId||booking.source!=='direct'||
    booking.GSI1PK!=='BOOKING_REQUESTS'||
    booking.status!=='APPROVED_AWAITING_PAYMENT'||
    booking.reservationStatus!=='AWAITING_PAYMENT'||
    !Number.isSafeInteger(booking.holdExpiresAt)||
    booking.holdExpiresAt<=nowEpoch)
  throw Error('Booking not eligible for checkout registration');
 const totalPence=Math.round(Number(booking.approvedAmountGBP)*100);
 if(!Number.isSafeInteger(totalPence)||totalPence<1||
    Math.abs(Number(booking.approvedAmountGBP)*100-totalPence)>0.000001)
  throw Error('Approved GBP amount missing or invalid');
 const schedule=booking.paymentSchedule;
 if(schedule && (schedule.totalPence!==totalPence||
    !Number.isSafeInteger(schedule.dueNowPence)||schedule.dueNowPence<1||
    !Number.isSafeInteger(schedule.balancePence)||schedule.balancePence<0||
    schedule.dueNowPence+schedule.balancePence!==totalPence))
  throw Error('Approved payment schedule disagrees with booking total');
 const amountPence=schedule?.dueNowPence??totalPence;
 // The orchestrator owns durable creation claims, provider-first lookup,
 // registration conditions and duplicate prevention.
 const result=await orchestrate({db,table,bookingId,amountPence,sumup,
  actor:identity.subject,nowEpoch,paymentSchedule:schedule});
 if(result?.status!=='REGISTERED'||result.record?.bookingId!==bookingId||
    result.record.amountPence!==amountPence||
    result.record.currency!=='GBP'||result.record.status!=='PENDING')
  throw Error('Checkout registration not verified');
 // Owner-only response. Guest notifications remain disabled and separate.
 return {status:'REGISTERED',bookingId,checkoutId:result.record.checkoutId,
  amountPence,currency:'GBP',guestNotificationSent:false};
}
