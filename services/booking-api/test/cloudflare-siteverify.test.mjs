import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareSiteverify} from '../cloudflare-siteverify.mjs';
test('Siteverify posts token and secret to the official endpoint',async()=>{
 let call;
 const verify=createCloudflareSiteverify({fetchImpl:async(url,options)=>{
  call={url,options};return {ok:true,text:async()=>JSON.stringify({
   success:true,hostname:'localhost',action:'booking_preflight'})};
 }});
 const result=await verify({secret:'synthetic-secret',response:'synthetic-token'});
 assert.equal(result.success,true);
 assert.equal(call.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
 assert.equal(call.options.method,'POST');
 assert.equal(new URLSearchParams(call.options.body).get('secret'),'synthetic-secret');
 assert.equal(new URLSearchParams(call.options.body).get('response'),'synthetic-token');
});
test('Siteverify rejects network errors, unsuccessful responses and malformed JSON',async()=>{
 for(const fetchImpl of [async()=>{throw Error('unavailable')},
  async()=>({ok:false,text:async()=>''}),
  async()=>({ok:true,text:async()=>'{not JSON'}),
  async()=>({ok:true,text:async()=>JSON.stringify({success:false})})]){
  const verify=createCloudflareSiteverify({fetchImpl});
  assert.equal((await verify({secret:'s',response:'t'})).success,false);
 }
});
test('Siteverify rejects invalid tokens before sending any request',async()=>{
 let called=false;
 const verify=createCloudflareSiteverify({fetchImpl:async()=>{called=true;throw Error('must not call')}});
 assert.equal((await verify({secret:'',response:'x'})).success,false);
 assert.equal((await verify({secret:'valid',response:'x'.repeat(2049)})).success,false);
 assert.equal(called,false);
});
