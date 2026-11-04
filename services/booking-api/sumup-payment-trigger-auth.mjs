// LB-08 authenticated INTERNAL trigger boundary, not a public SumUp webhook verifier.
// Only trusted infrastructure may hold the secret; never expose this handler to the public.
import {createHmac,timingSafeEqual} from 'node:crypto';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/i;
export function verifyInternalPaymentTrigger({body,signature,secret,nowEpoch=Math.floor(Date.now()/1000),
 maxAgeSeconds=300}={}){
 if(typeof secret!=='string'||secret.length<32||typeof body!=='string'||
    typeof signature!=='string'||!HEX.test(signature)||Buffer.byteLength(body)>2048||
    !Number.isSafeInteger(nowEpoch)||!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1)
  return {ok:false};
 const expected=createHmac('sha256',secret).update(body,'utf8').digest();
 const received=Buffer.from(signature,'hex');
 if(received.length!==expected.length||!timingSafeEqual(expected,received))return {ok:false};
 let parsed;
 try{parsed=JSON.parse(body);}catch{return {ok:false};}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||
    Object.keys(parsed).length!==2||!Object.hasOwn(parsed,'bookingId')||
    !Object.hasOwn(parsed,'issuedAt')||!ID.test(parsed.bookingId??'')||
    !Number.isSafeInteger(parsed.issuedAt)||parsed.issuedAt>nowEpoch+30||
    nowEpoch-parsed.issuedAt>maxAgeSeconds)return {ok:false};
 return {ok:true,bookingId:parsed.bookingId};
}
