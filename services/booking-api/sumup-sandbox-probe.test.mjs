import test from 'node:test';
import assert from 'node:assert/strict';
import {runSandboxProbe} from './sumup-sandbox-probe.mjs';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',LB08_READONLY_SANDBOX_PROBE:'yes'};
test('LB-08 CLI probe fails closed without explicit staging consent',async()=>{
 for(const bad of [{},{...env,AWS_REGION:'eu-west-1'},{...env,BOOKING_ENVIRONMENT:'production'},
  {...env,LB08_READONLY_SANDBOX_PROBE:'no'}]){
  await assert.rejects(runSandboxProbe({env:bad,ssmFactory:()=>{throw Error('must not connect');}}),
   /authorisation required/);
 }
});
test('LB-08 CLI probe only reports redacted success and closes SSM client',async()=>{
 let closed=0,called=0;
 const result=await runSandboxProbe({env,ssmFactory:()=>({destroy:()=>closed++}),
  probe:async({region})=>{called++;assert.equal(region,'eu-west-2');
    return {connected:true,merchantMatched:true,secret:'must-not-leak'};}});
 assert.deepEqual(result,{connected:true,region:'eu-west-2',environment:'staging',merchantMatched:true});
 assert.equal(closed,1);assert.equal(called,1);
 assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
});
test('LB-08 CLI probe always closes SSM connection on failed provider request',async()=>{
 let closed=0;
 await assert.rejects(runSandboxProbe({env,ssmFactory:()=>({destroy:()=>closed++}),
  probe:async()=>{throw Error('Sensitive provider response');}}),/Sensitive provider response/);
 assert.equal(closed,1);
});
