// Isolated reviewer-only Cognito OAuth 2.0 PKCE flow. No guest booking or payment capability.
const host='d123fnjf47zmyp.cloudfront.net';
const clientId='1mg4tcqcis2lptl2ecvfc1v7p6';
const domain='https://les-buttes-145608514666.auth.eu-west-2.amazoncognito.com';
const redirect='https://'+host+'/';
const prefix='lesbuttes:staging:reviewer:';
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
const safePath=(path:string)=>/^\/(?:fr\/|nl\/)?book\/$/.test(path)?path:'/book/';
export function reviewerToken():string|null{
  if(location.hostname!==host)return null;
  const token=sessionStorage.getItem(prefix+'id_token');
  const expiry=Number(sessionStorage.getItem(prefix+'expiry')||0);
  if(!token||Date.now()>=expiry-60000){sessionStorage.removeItem(prefix+'id_token');return null;}
  return token;
}
export function reviewerSignOut(){
  sessionStorage.removeItem(prefix+'id_token');
  sessionStorage.removeItem(prefix+'expiry');
}
export async function reviewerSignIn(){
  if(location.hostname!==host)return;
  const verifier=random();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const state=random();
  sessionStorage.setItem(prefix+'verifier',verifier);
  sessionStorage.setItem(prefix+'state',state);
  sessionStorage.setItem(prefix+'return',safePath(location.pathname));
  const url=new URL(domain+'/oauth2/authorize');
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('redirect_uri',redirect);
  url.searchParams.set('scope','openid email profile');
  url.searchParams.set('code_challenge_method','S256');
  url.searchParams.set('code_challenge',base64url(digest));
  url.searchParams.set('state',state);
  location.assign(url.toString());
}
export async function completeReviewerCallback(){
  if(location.hostname!==host||location.pathname!=='/')return;
  const params=new URLSearchParams(location.search);
  if(!params.has('code')&&!params.has('error'))return;
  const state=sessionStorage.getItem(prefix+'state');
  const verifier=sessionStorage.getItem(prefix+'verifier');
  const returnPath=safePath(sessionStorage.getItem(prefix+'return')||'/book/');
  sessionStorage.removeItem(prefix+'state');
  sessionStorage.removeItem(prefix+'verifier');
  sessionStorage.removeItem(prefix+'return');
  history.replaceState(null,'',location.pathname);
  if(!state||!verifier||params.get('state')!==state||!params.get('code')){
    location.replace(returnPath+'?reviewer_auth=failed');return;
  }
  try{
    const response=await fetch(domain+'/oauth2/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,
        code:params.get('code')!,redirect_uri:redirect,code_verifier:verifier})
    });
    if(!response.ok)throw Error('token exchange failed');
    const data=await response.json() as {id_token?:string;expires_in?:number};
    if(!data.id_token||!Number.isFinite(data.expires_in)||!data.expires_in)throw Error('missing token');
    sessionStorage.setItem(prefix+'id_token',data.id_token);
    sessionStorage.setItem(prefix+'expiry',String(Date.now()+data.expires_in*1000));
    location.replace(returnPath);
  }catch{reviewerSignOut();location.replace(returnPath+'?reviewer_auth=failed');}
}
