import test from 'node:test';
import assert from 'node:assert/strict';
import {runSandboxProbe,classifySandboxProbeError} from './sumup-sandbox-probe.mjs';
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

test('LB-08 maps provider and AWS errors to safe diagnostics',()=>{
 const cases=[
  [{name:'AccessDeniedException'},'AWS_CREDENTIALS_OR_PERMISSIONS'],
  [{name:'ParameterNotFound'},'SSM_PARAMETER_MISSING'],
  [{message:'Sandbox credentials missing or invalid'},'SSM_PARAMETER_VALUE_INVALID'],
  [{message:'SumUp API request failed: 401'},'SUMUP_UNAUTHORISED'],
  [{message:'SumUp API request failed: 403'},'SUMUP_FORBIDDEN'],
  [{message:'SumUp API request failed: 404'},'SUMUP_ENDPOINT_NOT_FOUND'],
  [{message:'Sandbox merchant identity mismatch'},'SUMUP_MERCHANT_MISMATCH']
 ];
 for(const [error,expected] of cases)assert.equal(classifySandboxProbeError(error),expected);
 assert.equal(classifySandboxProbeError({message:'sensitive-token-value'}),'UNCLASSIFIED_CONNECTIVITY_FAILURE');
});
