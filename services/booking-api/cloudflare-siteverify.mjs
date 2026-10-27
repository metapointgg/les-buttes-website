// Server-only Cloudflare Turnstile verification transport. No secrets are logged.
// Cloudflare tokens are single-use and valid for five minutes.
const ENDPOINT='https://challenges.cloudflare.com/turnstile/v0/siteverify';
export function createCloudflareSiteverify({fetchImpl=globalThis.fetch,timeoutMs=5000}={}){
 if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)
  throw Error('Invalid Siteverify client configuration');
 return async function siteverify({secret,response}={}){
  if(typeof secret!=='string'||!secret||typeof response!=='string'||!response||
     response.length>2048)return {success:false};
  try{
   const result=await fetchImpl(ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({secret,response}).toString(),
    signal:AbortSignal.timeout(timeoutMs),
    redirect:'error'
   });
   if(!result?.ok)return {success:false};
   const text=await result.text();
   if(text.length>8192)return {success:false};
   const data=JSON.parse(text);
   if(!data||typeof data!=='object'||Array.isArray(data))return {success:false};
   return {success:data.success===true,hostname:data.hostname,action:data.action};
  }catch{return {success:false};}
 };
}
