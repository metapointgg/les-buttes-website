import test from 'node:test';
import assert from 'node:assert/strict';
import {authorisedPaymentSchedule,reconcileScheduledPayments} from './staging-payment-schedule.mjs';
const env={BOOKING_ENVIRONMENT:'staging',BOOKING_AUTOMATIC_RECONCILIATION_ENABLED:'true',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
const event={source:'aws.events','detail-type':'Scheduled Event',account:'145608514666',region:'eu-west-2',resources:['arn:aws:events:eu-west-2:145608514666:rule/les-buttes-sandbox-payment-reconciliation']};
test('schedule rejects foreign sources, production, missing gates and altered rule',()=>{
 assert.equal(authorisedPaymentSchedule(event,env),true);
 for(const e of [{...event,account:'000000000000'},{...event,resources:[]},{...event,source:'browser'},{}])assert.equal(authorisedPaymentSchedule(e,env),false);
 assert.equal(authorisedPaymentSchedule(event,{...env,BOOKING_ENVIRONMENT:'production'}),false);
 assert.equal(authorisedPaymentSchedule(event,{...env,BOOKING_AUTOMATIC_RECONCILIATION_ENABLED:'false'}),false);
});
test('schedule processes only unexpired synthetic approved checkouts and isolates pending failures',async()=>{
 const base={status:'APPROVED_AWAITING_PAYMENT',synthetic:true,guestEmail:'test@example.invalid',holdExpiresAt:200};
 let calls=0;
 const records=[{...base,id:'pending'},{...base,id:'paid'},{...base,id:'expired',holdExpiresAt:50},{...base,id:'real',synthetic:false},{...base,id:'confirmed',status:'CONFIRMED'}];
 const db={send:async c=>c.input.IndexName?{Items:records.map(({id,status})=>({id,status}))}:c.input.Key.SK==='META'?{Item:records.find(r=>'BOOKING#'+r.id===c.input.Key.PK)}:{Item:{}}};
 let expirations=0,errors=0;const originalError=console.error;console.error=()=>errors++;
 try{
  const result=await reconcileScheduledPayments(event,{env,db,now:()=>100,
   expire:async({booking,nowEpoch})=>{expirations++;assert.equal(booking.id,'expired');assert.equal(nowEpoch,100);return {status:'EXPIRED'};},
   reconcile:async({bookingId,identity})=>{
    calls++;assert.equal(identity.subject,'system:staging-sandbox-payment-reconciliation');
    if(bookingId==='pending')throw Error('Payment not verified: Provider has not confirmed payment');return {status:'CONFIRMED'};
   }});
  assert.deepEqual(result,{confirmed:1,pending:1,review:0,pendingOrReview:1,expired:1});
 }finally{console.error=originalError;}
 assert.equal(errors,0);assert.equal(calls,2);assert.equal(expirations,1);
});
