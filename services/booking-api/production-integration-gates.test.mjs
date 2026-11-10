import test from 'node:test';import assert from 'node:assert/strict';
import {productionRequestGate,loadProductionTurnstileSecret,productionEmailGate,allowedProductionOrigin} from './production-integration-gates.mjs';
const base={BOOKING_ENVIRONMENT:'production',BOOKINGS_TABLE:'les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2',BOOKING_REQUESTS_ENABLED:'true',LIVE_BOOKINGS_APPROVED:'true'};
test('production request and origin gates require explicit approval',()=>{
 assert.equal(productionRequestGate(base),true);assert.equal(productionRequestGate({...base,LIVE_BOOKINGS_APPROVED:'false'}),false);
 assert.equal(allowedProductionOrigin('https://lesbuttes.com'),true);assert.equal(allowedProductionOrigin('https://www.lesbuttes.com'),true);assert.equal(allowedProductionOrigin('https://example.com'),false);
});
test('production Turnstile secret uses one fixed encrypted parameter and rejects test keys',async()=>{
 const calls=[];const secret=await loadProductionTurnstileSecret({env:base,ssm:{send:async command=>(calls.push(command.input),{Parameter:{Value:'real-looking-secret-value'}})}});
 assert.equal(secret,'real-looking-secret-value');assert.deepEqual(calls,[{Name:'/les-buttes/booking/production/turnstile/secret',WithDecryption:true}]);
 let count=0;await assert.rejects(loadProductionTurnstileSecret({env:{...base,LIVE_BOOKINGS_APPROVED:'false'},ssm:{send:async()=>{count++;}}}),/not approved/);assert.equal(count,0);
 await assert.rejects(loadProductionTurnstileSecret({env:base,ssm:{send:async()=>({Parameter:{Value:'1x0000000000000000000000000000000AA'}})}}),/invalid/);
});
test('production email gate is pinned to verified SES region and Les Buttes sender',()=>{
 const ok={...base,EMAILS_ENABLED:'true',LIVE_EMAILS_APPROVED:'true',BOOKING_SES_REGION:'us-east-1',BOOKING_SES_FROM:'bookings@lesbuttes.com',BOOKING_SES_SIMULATOR_ENABLED:'false'};
 assert.equal(productionEmailGate(ok),true);
 for(const patch of [{LIVE_EMAILS_APPROVED:'false'},{BOOKING_SES_REGION:'eu-west-2'},{BOOKING_SES_FROM:'guest@example.com'},{BOOKING_SES_SIMULATOR_ENABLED:'true'}])assert.equal(productionEmailGate({...ok,...patch}),false);
});
