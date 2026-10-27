// Isolated synthetic-only preview writer. Never accept or persist real guest contact data.
// Dependencies are injected to permit tests without AWS or Turnstile access.
import {buildSyntheticHold} from './synthetic-hold.mjs';
const validOrigin=/^https?:\/\/(localhost|127\.0\.0\.1):4321$/;
const visitorFields=new Set(['unit','start','end','adults','children','firstName','lastName','email','telephone','notes','turnstileToken']);
export async function createStagingGuestRequest({payload,origin,ip,verifyTurnstile,loadSnapshots,writeHold,now=Date.now()}){
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.BOOKING_STAGING_GUEST_WRITES!=='true')throw Error('Submission disabled');
 if(typeof origin!=='string'||!validOrigin.test(origin)||origin!==process.env.ALLOWED_PREVIEW_ORIGIN)throw Error('Origin not allowed');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(x=>!visitorFields.has(x)))throw Error('Unexpected fields');
 if(JSON.stringify(payload).length>3500)throw Error('Request too large');
 const {unit,start,end,adults,children,turnstileToken}=payload;
 if(!['geranium','honeysuckle','both'].includes(unit)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start??'')||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end??''))throw Error('Invalid stay');
 if(!Number.isInteger(adults)||!Number.isInteger(children)||adults<1||children<0||adults+children>10)throw Error('Invalid party');
 if(typeof turnstileToken!=='string'||turnstileToken.length<10||turnstileToken.length>2048)throw Error('Verification required');
 // Accept real-looking typed details for UX validation, but discard them before all storage.
 if(typeof payload.firstName!=='string'||payload.firstName.trim().length<1||payload.firstName.length>80||
    typeof payload.lastName!=='string'||payload.lastName.trim().length<1||payload.lastName.length>80||
    typeof payload.email!=='string'||payload.email.length>254||!/^\S+@\S+\.\S+$/.test(payload.email)||
    typeof payload.telephone!=='string'||payload.telephone.length>40||payload.telephone.replace(/\D/g,'').length<7||
    typeof (payload.notes??'')!=='string'||(payload.notes??'').length>1000)throw Error('Invalid guest details');
 const verified=await verifyTurnstile(turnstileToken,ip);
 if(!verified)throw Error('Verification failed');
 const {availability,pricing}=await loadSnapshots();
 const hold=buildSyntheticHold({availability,pricing,unit,start,end,adults,children,nowEpoch:Math.floor(now/1000)});
 // The original builder guarantees these are test identities and labelled synthetic.
 if(hold.meta.synthetic!==true||hold.meta.guestEmail!=='test@example.invalid')throw Error('Unsafe request');
 await writeHold(hold);
 return {reference:hold.meta.id,status:'REQUESTED',synthetic:true,totalGBP:hold.quote.totalGBP,
  holdExpiresAt:hold.meta.holdExpiresAt,message:'Synthetic staging request received. No real booking, email, or payment was created.'};
}
