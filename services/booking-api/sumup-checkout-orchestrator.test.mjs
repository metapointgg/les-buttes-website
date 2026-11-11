import test from 'node:test';import assert from 'node:assert/strict';
import {createAndRegisterCheckout,checkoutReference} from './sumup-checkout-orchestrator.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
const reference=checkoutReference(bookingId);
const checkout={checkoutId:'checkout-12345678',reference,amountPence:163000,
 currency:'GBP',status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/pay/checkout-12345678'};
const table='booking-staging';
test('LB-07 deterministic reference, provider-first lookup, and atomic registration',async()=>{
 let created=0,lookups=0,transactions=0;
 const db={send:async command=>{
  if(command.input.Key)return {};
  if(command.input.TransactItems)transactions++;return {};
 }};
 const result=await createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async input=>{created++;assert.equal(input.reference,reference);return checkout;}},
  lookupProviderByReference:async ref=>{lookups++;assert.equal(ref,reference);return [];}});
 assert.equal(result.status,'REGISTERED');
 assert.equal(created,1);assert.equal(lookups,1);assert.equal(transactions,1);
 assert.equal(checkoutReference(bookingId),reference);
});
test('LB-07 provider lookup failure prevents creating a second checkout',async()=>{
 let created=0;
 const db={send:async()=>({})};
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>{created++;return checkout;}},
  lookupProviderByReference:async()=>{throw Error('Provider unavailable');}}),/Provider unavailable/);
 assert.equal(created,0);
});
test('LB-07 remote pending checkout is reused and never duplicated',async()=>{
 let created=0;
 const db={send:async command=>command.input.Key?{}:{}};
 const result=await createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>{created++;return checkout;}},
  lookupProviderByReference:async()=>[checkout]});
 assert.equal(result.status,'REGISTERED');assert.equal(created,0);
});
test('LB-07 failed registration never releases an unregistered payment URL',async()=>{
 const db={send:async command=>{
  if(command.input.Key)return {};
  if(command.input.TransactItems)throw Error('DynamoDB transaction failed');
  return {};
 }};
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[]}),/requires reconciliation/);
});
test('LB-07 provider conflicts and unsafe environment fail closed',async()=>{
 const db={send:async()=>({})};
 await assert.rejects(createAndRegisterCheckout({db,table:'booking-production',bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[]}),/unavailable/);
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[checkout,checkout]}),/Multiple provider/);
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,actor:'owner',
  sumup:{createCheckout:async()=>checkout},lookupProviderByReference:async()=>[{...checkout,amountPence:10}]}),/manual reconciliation/);
});

test('LB-08 checkout orchestrator uses SumUp client reference lookup without creating duplicate',async()=>{
 let creations=0,lookups=0,claims=0;
 const db={send:async cmd=>{
  if(cmd.input.Key)return {};
  if(cmd.input.TransactItems)claims++;
  return {};
 }};
 const result=await createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  actor:'staging-owner',sumup:{
   listCheckoutsByReference:async ref=>{
    lookups++;assert.equal(ref,reference);return [checkout];},
   createCheckout:async()=>{creations++;throw Error('Must not create another checkout');}
  }});
 assert.equal(result.status,'REGISTERED');
 assert.equal(creations,0);
 assert.equal(lookups,1);
 assert.equal(claims,1);
});
test('LB-08 lookup errors fail closed before obtaining creation claim',async()=>{
 let claims=0,creations=0;
 const db={send:async cmd=>{if(cmd.input.TransactItems)claims++;return {};}};
 await assert.rejects(createAndRegisterCheckout({db,table,bookingId,amountPence:163000,
  actor:'staging-owner',sumup:{
   listCheckoutsByReference:async()=>{throw Error('SumUp lookup unavailable');},
   createCheckout:async()=>{creations++;}
  }}),/SumUp lookup unavailable/);
 assert.equal(claims,0);
 assert.equal(creations,0);
});


const LIVE_TABLE='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const LIVE_KEYS=['BOOKING_ENVIRONMENT','AWS_REGION','BOOKINGS_TABLE','PAYMENTS_ENABLED','LIVE_PAYMENTS_APPROVED'];
async function withLivePaymentEnvironment(enabled,work){
 const previous=Object.fromEntries(LIVE_KEYS.map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,{BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',
   BOOKINGS_TABLE:LIVE_TABLE,PAYMENTS_ENABLED:enabled?'true':'false',
   LIVE_PAYMENTS_APPROVED:enabled?'true':'false'});
  return await work();
 }finally{
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
}

test('live checkout creation atomically claims and registers only after both production payment approvals',async()=>{
 await withLivePaymentEnvironment(true,async()=>{
  const calls=[];
  const db={send:async command=>{calls.push(command.input);return {};}};
  const result=await createAndRegisterCheckout({db,table:LIVE_TABLE,bookingId,
   amountPence:163000,actor:'production-owner',
   sumup:{listCheckoutsByReference:async()=>[],createCheckout:async input=>({
    ...checkout,reference:input.reference,amountPence:input.amountPence
   })}});
  assert.equal(result.status,'REGISTERED');
  assert.equal(result.record.amountPence,163000);
  assert.equal(calls.filter(x=>x.TransactItems).length,1);
  assert.equal(calls.filter(x=>x.Item?.status==='CREATING').length,1);
  assert.equal(calls.filter(x=>x.UpdateExpression).length,1);
 });
 await withLivePaymentEnvironment(false,async()=>{
  let called=0;
  const db={send:async()=>{called++;return {};}};
  await assert.rejects(createAndRegisterCheckout({db,table:LIVE_TABLE,bookingId,
   amountPence:163000,actor:'production-owner',
   sumup:{listCheckoutsByReference:async()=>[],createCheckout:async()=>{throw Error('Must not call provider');}}}),/unavailable/);
  assert.equal(called,0);
 });
});


test('second owner-only production checkout expires at SumUp after two hours',async()=>{
 await withLivePaymentEnvironment(true,async()=>{
  const previous=process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED;
  process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED='true';
  try{
   const nowEpoch=1794420000,inputs=[];
   const db={send:async()=>({})};
   const result=await createAndRegisterCheckout({db,table:LIVE_TABLE,bookingId,
    amountPence:100,actor:'controlled-email-owner',nowEpoch,
    sumup:{listCheckoutsByReference:async()=>[],createCheckout:async input=>{
     inputs.push(input);return {...checkout,amountPence:100};
    }}});
   assert.equal(result.status,'REGISTERED');
   assert.equal(inputs.length,1);
   assert.equal(inputs[0].validUntil,new Date((nowEpoch+7200)*1000).toISOString());
  }finally{
   if(previous===undefined)delete process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED;
   else process.env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED=previous;
  }
 });
});
