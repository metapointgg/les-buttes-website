import test from 'node:test';
import assert from 'node:assert/strict';
import {readTurnstileSecret,TURNSTILE_PARAMETER} from '../booking-turnstile-secret.mjs';
test('reads exact SSM SecureString with decryption and no wildcard',async()=>{
 let request;
 const secret=await readTurnstileSecret({ssm:{send:async command=>{
  request=command.input;
  return {Parameter:{Name:TURNSTILE_PARAMETER,Type:'SecureString',Value:'synthetic-only-secret'}};
 }}});
 assert.equal(secret,'synthetic-only-secret');
 assert.deepEqual(request,{Name:TURNSTILE_PARAMETER,WithDecryption:true});
});
test('rejects missing, wrong-type, wrong-name and failed secret retrieval without leaking details',async()=>{
 for(const res of [undefined,{Parameter:{Name:TURNSTILE_PARAMETER,Type:'String',Value:'synthetic-only-secret'}},
  {Parameter:{Name:'/other',Type:'SecureString',Value:'synthetic-only-secret'}},
  {Parameter:{Name:TURNSTILE_PARAMETER,Type:'SecureString',Value:''}}]){
  await assert.rejects(readTurnstileSecret({ssm:{send:async()=>res}}),/Turnstile secret unavailable/);
 }
 await assert.rejects(readTurnstileSecret({ssm:{send:async()=>{throw Error('secret test detail')}}}),
  e=>e.message==='Turnstile secret unavailable');
 await assert.rejects(readTurnstileSecret({ssm:{send:async()=>({})},name:'/wrong'}));
});
