// LB-09: staging-only SES sending policy. No AWS SDK or network side effects.
// SES domain/DKIM verification in us-east-1 does not remove SES sandbox restrictions.
const FROM=/^[A-Z0-9._%+-]+@lesbuttes\.com$/i;
const EMAIL=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const TYPES=new Set(['approval_payment','declined','confirmed','cancelled','hold_expired','delivery_failure']);
const TEMPLATE=/^[a-z0-9][a-z0-9_-]{1,80}$/;
function normaliseEmail(value){
 return typeof value==='string'&&EMAIL.test(value.trim())?value.trim().toLowerCase():null;
}
export function stagingSesPolicy(env=process.env){
 const failures=[];
 if(env.BOOKING_ENVIRONMENT!=='staging')failures.push('Not a staging booking environment');
 // This is deliberately *not* taken from AWS_REGION (the booking Lambda runs in eu-west-2).
 if(env.BOOKING_SES_REGION!=='us-east-1')failures.push('SES sending region must explicitly be us-east-1');
 if(env.BOOKING_EMAILS_ENABLED!=='true')failures.push('Staging email sending is disabled');
 if(env.BOOKING_SES_SANDBOX_ACK!=='true')failures.push('SES sandbox restriction not acknowledged');
 const sender=normaliseEmail(env.BOOKING_SES_FROM);
 if(!sender||!FROM.test(sender))failures.push('Sender must belong to lesbuttes.com');
 const entries=typeof env.BOOKING_SES_TEST_RECIPIENTS==='string'?
  env.BOOKING_SES_TEST_RECIPIENTS.split(',').map(s=>s.trim()):[];
 const allowlist=new Set(entries.map(normaliseEmail));
 if(entries.length===0||entries.length>20||allowlist.has(null)||allowlist.size!==entries.length)
  failures.push('Explicit, valid, unique staging test-recipient allowlist required');
 return {enabled:failures.length===0,failures,region:'us-east-1',sender,allowlist};
}
export function validateStagingSesMessage({env=process.env,to,type,subject,body,
 templateId,bookingId}={}){
 const policy=stagingSesPolicy(env),failures=[...policy.failures];
 const recipient=normaliseEmail(to);
 if(!recipient||!policy.allowlist.has(recipient))
  failures.push('Recipient is not explicitly allowlisted for staging');
 if(!TYPES.has(type))failures.push('Unsupported booking lifecycle email');
 if(typeof subject!=='string'||subject.length<4||subject.length>160||/[\r\n]/.test(subject))
  failures.push('Invalid email subject');
 if(typeof body!=='string'||body.length<10||body.length>15000)
  failures.push('Invalid email body');
 if(typeof templateId!=='string'||!TEMPLATE.test(templateId))
  failures.push('Explicit template identifier required');
 if(typeof bookingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(bookingId))
  failures.push('Valid booking reference required');
 return {allowed:failures.length===0,failures,region:policy.region,
  sender:policy.sender,recipient,type,templateId,bookingId};
}
