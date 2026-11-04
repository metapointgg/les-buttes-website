// LB-05: browser-only, isolated management staging PKCE sign-in.
// No tokens are persisted. The API Gateway JWT authorizer validates signatures.
export const hostedManagement=Object.freeze({
 origin:'https://d123fnjf47zmyp.cloudfront.net',
 path:'/management/index.html',
 redirect:'https://d123fnjf47zmyp.cloudfront.net/management/index.html',
 api:'https://g2vazft1vb.execute-api.eu-west-2.amazonaws.com',
 issuer:'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa',
 domain:'https://les-buttes-145608514666.auth.eu-west-2.amazoncognito.com',
 clientId:'1a0i42vp4gi24i5orh8i4jjhmr'
});
const VERIFIER='lb:read-only-management:verifier';
const STATE='lb:read-only-management:state';
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const isHostedManagement=loc=>loc?.origin===hostedManagement.origin&&loc?.pathname===hostedManagement.path;
export function clearPendingSignIn(session){
 session?.removeItem(VERIFIER);
 session?.removeItem(STATE);
}
export async function createHostedAuthorisationUrl({session,cryptoApi}={}){
 if(!session?.setItem||!cryptoApi?.getRandomValues||!cryptoApi?.subtle?.digest)
  throw Error('A secure browser is required for Cognito sign-in');
 const verifier=encode(cryptoApi.getRandomValues(new Uint8Array(48)));
 const state=encode(cryptoApi.getRandomValues(new Uint8Array(32)));
 session.setItem(VERIFIER,verifier);
 session.setItem(STATE,state);
 const hash=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const url=new URL(hostedManagement.domain+'/oauth2/authorize');
 for(const [key,value] of Object.entries({
  response_type:'code',client_id:hostedManagement.clientId,
  redirect_uri:hostedManagement.redirect,scope:'openid email profile',
  code_challenge_method:'S256',code_challenge:encode(hash),state
 }))url.searchParams.set(key,value);
 return url.toString();
}
export function decodeStagingAccessClaims(token,{now=Date.now()}={}){
 if(typeof token!=='string'||token.length>12000||token.split('.').length!==3)
  throw Error('Invalid Cognito access token');
 let claims;
 try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}
 catch{throw Error('Invalid Cognito access token');}
 const groups=claims?.['cognito:groups'];
 if(claims?.token_use!=='access'||claims.iss!==hostedManagement.issuer||
  claims.client_id!==hostedManagement.clientId||
  !Number.isFinite(claims.exp)||claims.exp<=Math.floor(now/1000)+15||
  !Array.isArray(groups)||!groups.includes('lesbuttes-viewer'))
  throw Error('This account does not have staging booking viewer access');
 return claims;
}
export async function completeHostedSignIn({search,session,fetchImpl,now=Date.now()}={}){
 const params=new URLSearchParams(search??'');
 if(!params.has('code')&&!params.has('error'))return null;
 const expectedState=session?.getItem(STATE),verifier=session?.getItem(VERIFIER);
 clearPendingSignIn(session);
 if(params.has('error'))throw Error('Cognito sign-in was cancelled or rejected');
 if(!expectedState||!verifier||params.get('state')!==expectedState||
  typeof params.get('code')!=='string'||!params.get('code')||params.get('code').length>2048)
  throw Error('Cognito sign-in state validation failed');
 if(typeof fetchImpl!=='function')throw Error('Secure token exchange unavailable');
 const response=await fetchImpl(hostedManagement.domain+'/oauth2/token',{
  method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({
   grant_type:'authorization_code',client_id:hostedManagement.clientId,
   redirect_uri:hostedManagement.redirect,code:params.get('code'),code_verifier:verifier
  }),
  cache:'no-store',credentials:'omit',redirect:'error'
 });
 if(!response.ok)throw Error('Cognito token exchange failed');
 const data=await response.json();
 decodeStagingAccessClaims(data?.access_token,{now});
 return data.access_token;
}
export function hostedSignOutUrl(){
 const url=new URL(hostedManagement.domain+'/logout');
 url.searchParams.set('client_id',hostedManagement.clientId);
 url.searchParams.set('logout_uri',hostedManagement.redirect);
 return url.toString();
}
