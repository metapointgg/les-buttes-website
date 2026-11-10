import test from 'node:test';import assert from 'node:assert/strict';
import {productionPaymentsEnabled,loadProductionSumUpCredentials,createVerifiedProductionSumUpClient} from './sumup-production-runtime.mjs';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const enabled={BOOKING_ENVIRONMENT:'production',AWS_REGION:'eu-west-2',BOOKINGS_TABLE:table,PAYMENTS_ENABLED:'true',LIVE_PAYMENTS_APPROVED:'true'};
test('production payment runtime is disabled unless every release gate matches',async()=>{
 assert.equal(productionPaymentsEnabled(enabled),true);
 for(const patch of [{PAYMENTS_ENABLED:'false'},{LIVE_PAYMENTS_APPROVED:'false'},{BOOKING_ENVIRONMENT:'staging'},{BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-X'}]){let calls=0;await assert.rejects(loadProductionSumUpCredentials({env:{...enabled,...patch},ssm:{send:async()=>{calls++;}}}),/not approved/);assert.equal(calls,0);}
});
test('production credentials use fixed paths and verified live merchant',async()=>{
 const commands=[];const ssm={send:async command=>{commands.push(command.input);return command.input.Name.endsWith('api-key')?{Parameter:{Value:'sup_sk_live_mock'}}:{Parameter:{Value:'MLIVE123'}};}};let clientArgs;
 const client=await createVerifiedProductionSumUpClient({ssm,env:enabled,fetchImpl:async(url,options)=>{assert.equal(url,'https://api.sumup.com/v1/merchants/MLIVE123');assert.match(options.headers.Authorization,/^Bearer sup_sk_/);return {ok:true,json:async()=>({merchant_code:'MLIVE123',sandbox:false,default_currency:'GBP'})};},clientFactory:args=>(clientArgs=args,{verified:true})});
 assert.deepEqual(client,{verified:true});assert.deepEqual(commands,[{Name:'/les-buttes/booking/production/sumup/api-key',WithDecryption:true},{Name:'/les-buttes/booking/production/sumup/merchant-code',WithDecryption:false}]);assert.equal(clientArgs.providerEnvironment,'live');
});
test('production runtime refuses sandbox or mismatched merchant before client creation',async()=>{
 const ssm={send:async command=>command.input.Name.endsWith('api-key')?{Parameter:{Value:'sup_sk_live_mock'}}:{Parameter:{Value:'MLIVE123'}}};
 for(const merchant of [{merchant_code:'MLIVE123',sandbox:true},{merchant_code:'OTHER123',sandbox:false},{}]){let created=0;await assert.rejects(createVerifiedProductionSumUpClient({ssm,env:enabled,fetchImpl:async()=>({ok:true,json:async()=>merchant}),clientFactory:()=>{created++;}}),/Live SumUp merchant verification required/);assert.equal(created,0);}
});
