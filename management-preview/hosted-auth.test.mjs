import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHostedAuthorisationUrl,completeHostedSignIn,decodeStagingAccessClaims,
 hostedSignOutUrl,isHostedManagement,hostedManagement} from './hosted-auth.mjs';
const session=()=>{const values=new Map();return {
 getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),
 removeItem:k=>values.delete(k),keys:()=>[...values.keys()]
};};
const fakeCrypto={getRandomValues:bytes=>{bytes.fill(bytes.length);return bytes;},
 subtle:{digest:async(algorithm,bytes)=>{
  assert.equal(algorithm,'SHA-256');
  return createHash('sha256').update(Buffer.from(bytes)).digest();
 }}};
const jwt=claims=>{
 const encoded=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 return encoded({alg:'RS256'})+'.'+encoded(claims)+'.signature-fixture';
};
const claims=()=>({iss:hostedManagement.issuer,client_id:hostedManagement.clientId,
 token_use:'access',exp:Math.floor(Date.now()/1000)+1200,'cognito:groups':['management','lesbuttes-viewer']});
test('LB-05 PKCE requires exact isolated staging page and uses S256/nonce without token storage',async()=>{
 assert.equal(isHostedManagement({origin:hostedManagement.origin,pathname:hostedManagement.path}),true);
 assert.equal(isHostedManagement({origin:'https://lesbuttes.com',pathname:hostedManagement.path}),false);
 const s=session(),url=new URL(await createHostedAuthorisationUrl({session:s,cryptoApi:fakeCrypto}));
 assert.equal(url.origin,'https://les-buttes-145608514666.auth.eu-west-2.amazoncognito.com');
 assert.equal(url.pathname,'/oauth2/authorize');
 assert.equal(url.searchParams.get('client_id'),hostedManagement.clientId);
 assert.equal(url.searchParams.get('redirect_uri'),hostedManagement.redirect);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('scope'),'openid email profile');
 assert.ok(url.searchParams.get('code_challenge').length>=40);
 assert.equal(s.keys().length,2);
 assert.equal(s.keys().some(k=>/access.?token/i.test(k)),false);
});
test('LB-05 completed code exchange validates state and enforces access-token viewer role',async()=>{
 const s=session(),url=new URL(await createHostedAuthorisationUrl({session:s,cryptoApi:fakeCrypto}));
 let calls=0;
 const token=jwt(claims());
 const result=await completeHostedSignIn({
  search:'?code=one-time-code&state='+encodeURIComponent(url.searchParams.get('state')),
  session:s,
  fetchImpl:async(endpoint,opts)=>{
   calls++;assert.equal(endpoint,hostedManagement.domain+'/oauth2/token');
   assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');
   assert.equal(opts.body.get('grant_type'),'authorization_code');
   assert.equal(opts.body.get('redirect_uri'),hostedManagement.redirect);
   assert.equal(opts.body.get('client_id'),hostedManagement.clientId);
   assert.ok(opts.body.get('code_verifier'));
   return {ok:true,json:async()=>({access_token:token})};
  }
 });
 assert.equal(result,token);assert.equal(calls,1);assert.deepEqual(s.keys(),[]);
 assert.equal(decodeStagingAccessClaims(token)['cognito:groups'].includes('lesbuttes-viewer'),true);
});
test('LB-05 rejects replay/CSRF and missing or elevated Cognito identity before fetch',async()=>{
 const s=session(),url=new URL(await createHostedAuthorisationUrl({session:s,cryptoApi:fakeCrypto}));
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({access_token:jwt(claims())})};};
 await assert.rejects(completeHostedSignIn({search:'?code=abc&state=wrong',session:s,fetchImpl}),/state validation/);
 assert.equal(calls,0);
 await assert.rejects(completeHostedSignIn({search:'?code=abc&state='+url.searchParams.get('state'),session:s,fetchImpl}),/state validation/);
 assert.equal(calls,0);
 for(const change of [
  {'cognito:groups':['management']},
  {'cognito:groups':['lesbuttes-owner']},
  {token_use:'id'},
  {client_id:'different'},
  {exp:Math.floor(Date.now()/1000)-1},
  {iss:'https://invalid.example'}
 ])assert.throws(()=>decodeStagingAccessClaims(jwt({...claims(),...change})),/staging booking viewer access/);
});
test('LB-05 sign-out is restricted to exact staging client and redirect',()=>{
 const logout=new URL(hostedSignOutUrl());
 assert.equal(logout.pathname,'/logout');
 assert.equal(logout.searchParams.get('client_id'),hostedManagement.clientId);
 assert.equal(logout.searchParams.get('logout_uri'),hostedManagement.redirect);
});
