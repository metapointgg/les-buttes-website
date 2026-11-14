// Existing production EventBridge payment reconciliation schedule also handles
// the second instalment. No separate timer, email queue or payment gateway.
import {SSMClient} from '@aws-sdk/client-ssm';
import {createVerifiedProductionSumUpClient} from './sumup-production-runtime.mjs';
import {reconcileBalancePayment} from './production-balance-payments.mjs';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {currentBalanceReminderStage} from './production-balance-reminders.mjs';
import {dispatchProductionBookingLifecycleEmail} from './booking-production-email-dispatch.mjs';
import {createProductionSesTransport} from './booking-production-ses-transport.mjs';

export async function processProductionBalance({db,table,booking,env=process.env,
 clientFactory=createVerifiedProductionSumUpClient,ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 dispatch=dispatchProductionBookingLifecycleEmail,
 transportFactory=createProductionSesTransport,today=new Date().toISOString().slice(0,10)}={}){
 if(booking?.status!=='CONFIRMED'||booking?.paymentStatus!=='PARTIALLY_PAID'||
    booking.balanceDuePence<1||booking.synthetic===true) return {status:'SKIPPED'};
 const identity={role:'system',subject:'system:production-balance-reconciliation'};
 // Do not create a 30-minute SumUp checkout months before the guest pays.
 // The email always contains a durable Les Buttes link; the guest's click
 // creates or renews the provider session.
 const {Item:checkout}=await db.send(new GetCommand({TableName:table,
  Key:{PK:'BOOKING#'+booking.id,SK:'PAYMENT#BALANCE_CHECKOUT'},ConsistentRead:true}));
 if(checkout?.status==='PAID')
  throw Error('Settled balance checkout lacks a matching booking ledger update');
 if(checkout?.status==='PENDING'){
  const ssm=ssmFactory();
  try{
   const sumup=await clientFactory({ssm,env});
   try{
    const result=await reconcileBalancePayment({db,table,bookingId:booking.id,identity,sumup,env});
    if(result.status==='PAID_IN_FULL'){
     const notification=await dispatch({db,table,bookingId:booking.id,type:'balance_paid',
      transport:transportFactory(),env});
     if(!(notification?.status==='ACCEPTED_BY_SES_NOT_DELIVERED'||
       (notification?.status==='ALREADY_CLAIMED'&&notification.state==='ACCEPTED_BY_SES_NOT_DELIVERED')))
      throw Error('Final payment receipt requires review');
     return {status:'PAID_IN_FULL',notificationStatus:notification.status};
    }
   }catch(error){
    const message=String(error?.message);
    if(!message.includes('Balance payment not verified: Provider has not confirmed payment')&&
       !message.includes('Balance checkout is no longer payable'))
     throw error;
   }
  }finally{ssm.destroy?.();}
 }
  const stage=currentBalanceReminderStage({booking,today});
  if(stage===null)return {status:'PENDING',reminderStage:null};
  const notification=await dispatch({db,table,bookingId:booking.id,type:'balance_reminder',
   reminderStage:stage,transport:transportFactory(),env});
  if(!(notification?.status==='ACCEPTED_BY_SES_NOT_DELIVERED'||
      (notification?.status==='ALREADY_CLAIMED'&&notification.state==='ACCEPTED_BY_SES_NOT_DELIVERED')))
   throw Error('Balance reminder requires delivery review');
  return {status:'PENDING',reminderStage:stage,notificationStatus:notification.status};
 }
