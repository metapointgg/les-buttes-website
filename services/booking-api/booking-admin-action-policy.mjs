// Pure authorisation and transition policy for future management write endpoints.
// This module does not mutate bookings, authorise payments or send messages.
const actions=Object.freeze({
  approve:{from:'REQUESTED',to:'APPROVED_AWAITING_PAYMENT'},
  decline:{from:'REQUESTED',to:'DECLINED'},
  cancel:{from:'CONFIRMED',to:'CANCELLED'}
});
export function checkOwnerAction({identity,action,booking,reason}={}){
  if(!identity||identity.role!=='owner')return {allowed:false,reason:'Forbidden'};
  if(!Object.hasOwn(actions,action))return {allowed:false,reason:'Unsupported action'};
  if(!booking||booking.status!==actions[action].from)return {allowed:false,reason:'Invalid booking state'};
  if(action==='cancel'&&(typeof reason!=='string'||reason.trim().length<5||reason.length>1000))
    return {allowed:false,reason:'Cancellation requires a recorded reason'};
  if(['approve','decline'].includes(action)){
    // A missing, malformed or elapsed hold is never evidence of availability.
    if(!Number.isSafeInteger(booking.holdExpiresAt)||booking.holdExpiresAt<=Math.floor(Date.now()/1000))
      return {allowed:false,reason:'Booking hold missing or expired'};
  }
  return {allowed:true,from:actions[action].from,to:actions[action].to};
}
// Payment confirmation is intentionally NOT a management action: only a
// server-verified payment event may advance a booking to CONFIRMED.
