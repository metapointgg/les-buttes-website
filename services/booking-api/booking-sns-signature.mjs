// LB-09: verify AWS SNS notification signatures before processing SES feedback.
// This module performs no subscription confirmation or booking/payment mutation.
import {createVerify,X509Certificate} from 'node:crypto';
import {get as httpsGet} from 'node:https';

const CERT_NAME=/^\/SimpleNotificationService-[0-9a-fA-F]{32,64}\.pem$/;
const ARN=/^arn:aws:sns:us-east-1:145608514666:[A-Za-z0-9_-]{1,256}$/;
const BASE=['Message','MessageId','Subject','Timestamp','TopicArn','Type'];
export function snsSigningString(message){
 if(message?.Type!=='Notification')throw Error('SNS notification type required');
 let result='';
 for(const key of BASE){
  if(key==='Subject'&&!Object.hasOwn(message,'Subject'))continue;
  const value=message[key];
  if(typeof value!=='string'||value.length===0)throw Error('Invalid SNS signed field');
  result+=key+'\n'+value+'\n';
 }
 return result;
}
export function snsCertificateUrl(message){
 if(typeof message?.SigningCertURL!=='string')throw Error('SNS certificate URL required');
 let url;
 try{url=new URL(message.SigningCertURL);}catch{throw Error('Invalid SNS certificate URL');}
 if(url.protocol!=='https:'||url.hostname!=='sns.us-east-1.amazonaws.com'||
    url.port||url.username||url.password||url.search||url.hash||
    !CERT_NAME.test(url.pathname))
  throw Error('Untrusted SNS certificate URL');
 return url.toString();
}
export async function loadSnsSigningCertificate(url,{get=httpsGet}={}){
 // URL was restricted before calling this function. Repeat validation so direct
 // callers cannot turn this fetcher into an arbitrary-URL request.
 snsCertificateUrl({SigningCertURL:url});
 return await new Promise((resolve,reject)=>{
  let finished=false;const fail=e=>{if(!finished){finished=true;reject(e);}};
  const req=get(url,{timeout:5000},response=>{
   if(response.statusCode!==200){response.resume();fail(Error('SNS certificate fetch failed'));return;}
   let length=0,parts=[];
   response.on('data',chunk=>{
    length+=chunk.length;
    if(length>16384){response.destroy(Error('SNS certificate too large'));return;}
    parts.push(chunk);
   });
   response.on('error',fail);
   response.on('end',()=>{if(!finished){finished=true;resolve(Buffer.concat(parts).toString('utf8'));}});
  });
  req.on('timeout',()=>req.destroy(Error('SNS certificate timeout')));
  req.on('error',fail);
 });
}
export function createSnsNotificationVerifier({
 expectedTopicArn,
 loadCertificate=loadSnsSigningCertificate,
 now=()=>Date.now(),maxAgeMs=24*60*60*1000
}={}){
 if(typeof expectedTopicArn!=='string'||!ARN.test(expectedTopicArn)||
    typeof loadCertificate!=='function'||typeof now!=='function'||
    !Number.isSafeInteger(maxAgeMs)||maxAgeMs<60000||maxAgeMs>86400000)
  throw Error('Explicit staging us-east-1 SNS topic and verification settings required');
 return async message=>{
  try{
   if(!message||message.Type!=='Notification'||message.TopicArn!==expectedTopicArn||
      !['1','2'].includes(message.SignatureVersion)||
      typeof message.Signature!=='string'||message.Signature.length>8192)
    return false;
   const timestamp=Date.parse(message.Timestamp);
   if(!Number.isFinite(timestamp)||Math.abs(now()-timestamp)>maxAgeMs)
    return false;
   const url=snsCertificateUrl(message);
   const canonical=snsSigningString(message);
   const signature=Buffer.from(message.Signature,'base64');
   if(signature.length<128||signature.toString('base64')!==message.Signature)
    return false;
   const certificate=new X509Certificate(await loadCertificate(url));
   const instant=now();
   if(instant<Date.parse(certificate.validFrom)||instant>Date.parse(certificate.validTo))
    return false;
   const verifier=createVerify(message.SignatureVersion==='2'?'RSA-SHA256':'RSA-SHA1');
   verifier.update(canonical,'utf8');
   verifier.end();
   return verifier.verify(certificate.publicKey,signature);
  }catch{return false;}
 };
}
