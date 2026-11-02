import test from 'node:test';
import assert from 'node:assert/strict';
import {GetParameterCommand} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials,checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';
const apiKey='sup_sk_local-synthetic-not-real';
const merchantCode='ABCDEF12';
const ssm={send:async command=>{
 assert.ok(command instanceof GetParameterCommand);
 if(command.input.Name==='/les-buttes/staging/sumup/api-key'){
  assert.equal(command.input.WithDecryption,true);
  return {Parameter:{Value:apiKey}};
 }
 assert.equal(command.input.Name,'/les-buttes/staging/sumup/merchant-code');
 assert.equal(command.input.WithDecryption,false);
 return {Parameter:{Value:merchantCode}};
}};
test('LB-08 retrieves sandbox credentials from exact SSM paths',async()=>{
 assert.deepEqual(await loadSandboxSumUpCredentials({ssm}),{apiKey,merchantCode});
});
test('LB-08 connectivity uses only GET and returns no credentials or merchant profile',async()=>{
 let count=0;
 const fetchImpl=async(url,options)=>{
  count++;
  assert.equal(url,'https://api.sumup.com/v1/merchants/'+merchantCode);
  assert.equal(options.method??'GET','GET');
  assert.equal(options.headers.Authorization,'Bearer '+apiKey);
  return {ok:true,json:async()=>({merchant_code:merchantCode,sandbox:true,email:'private@example.invalid'})};
 };
 const output=await checkSandboxSumUpConnectivity({ssm,fetchImpl});
 assert.equal(count,1);assert.equal(output.connected,true);
 assert.equal(JSON.stringify(output).includes(apiKey),false);
 assert.equal(JSON.stringify(output).includes('private@example.invalid'),false);
});
test('LB-08 fails closed on mismatched merchant or failed API response',async()=>{
 await assert.rejects(checkSandboxSumUpConnectivity({ssm,fetchImpl:async()=>({
  ok:true,json:async()=>({merchant_code:'OTHER123'})})}),/merchant identity mismatch/);
 await assert.rejects(checkSandboxSumUpConnectivity({ssm,fetchImpl:async()=>({
  ok:false,status:401})}),/SumUp API request failed: 401/);
});
test('LB-08 rejects non-staging region and public keys',async()=>{
 await assert.rejects(loadSandboxSumUpCredentials({ssm,region:'us-east-1'}),/unavailable/);
 const liveSsm={send:async command=>({Parameter:{Value:command.input.Name.endsWith('api-key')?
  'sup_pk_not-a-secret':merchantCode}})};
 await assert.rejects(loadSandboxSumUpCredentials({ssm:liveSsm}),/secret API key missing or unexpected format/);
});

test('LB-08 refuses authenticated non-sandbox merchant without returning private data',async()=>{
 await assert.rejects(checkSandboxSumUpConnectivity({ssm,fetchImpl:async()=>({
  ok:true,json:async()=>({merchant_code:merchantCode,sandbox:false})})}),/not confirmed as sandbox/);
});
