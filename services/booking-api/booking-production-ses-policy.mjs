import {productionEmailGate} from './production-integration-gates.mjs';

const EMAIL=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const TYPES=new Set(['requested','owner_request','approval_payment','balance_reminder','balance_paid','declined','confirmed','cancelled','refund_confirmed','hold_expired','delivery_failure']);
const TEMPLATE=/^[a-z0-9][a-z0-9_-]{1,80}$/;
const normalise=value=>typeof value==='string'&&EMAIL.test(value.trim())?value.trim().toLowerCase():null;

export function validateProductionSesMessage({env=process.env,to,type,subject,body,templateId,bookingId}={}){
 const failures=[];
 if(!productionEmailGate(env))failures.push('Production email integration disabled');
 const recipient=normalise(to),owner=normalise(env.BOOKING_OWNER_EMAIL);
 if(!recipient)failures.push('Invalid production recipient');
 if(type==='owner_request'&&recipient!==owner)failures.push('Owner request recipient mismatch');
 if(type!=='owner_request'&&recipient===owner)failures.push('Guest lifecycle recipient must come from the booking');
 if(!TYPES.has(type))failures.push('Unsupported booking lifecycle email');
 if(typeof subject!=='string'||subject.length<4||subject.length>160||/[\r\n]/.test(subject))
  failures.push('Invalid email subject');
 if(typeof body!=='string'||body.length<10||body.length>15000)failures.push('Invalid email body');
 if(typeof templateId!=='string'||!TEMPLATE.test(templateId))failures.push('Explicit template identifier required');
 if(typeof bookingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(bookingId))
  failures.push('Valid booking reference required');
 return {allowed:failures.length===0,failures,region:'us-east-1',
  sender:'bookings@lesbuttes.com',recipient,type,templateId,bookingId};
}
