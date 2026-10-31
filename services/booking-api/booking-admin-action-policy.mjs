// Pure authorisation and transition policy for future management write endpoints.
// This module does not mutate bookings, authorise payments or send messages.
const actions=Object.freeze({
  approve:{from:'REQUESTED',to:'APPROVED_AWAITING_PAYMENT'},
  decline:{from:'REQUESTED',to:'DECLINED'},
  cancel:{from:'CONFIRMED',to:'CANCELLED'}
});
export function checkOwnerAction({identity,action,booking}={}){
  if(!identity||identity.role!=='owner')return {allowed:false,reason:'Forbidden'};
  if(!Object.hasOwn(actions,action))return {allowed:false,reason:'Unsupported action'};
  if(!booking||booking.status!==actions[action].from)return {allowed:false,reason:'Invalid booking state'};
  if(booking.holdExpiresAt&&['approve','decline'].includes(action)&&booking.holdExpiresAt<=Math.floor(Date.now()/1000))
    return {allowed:false,reason:'Booking hold expired'};
  return {allowed:true,from:actions[action].from,to:actions[action].to};
}
// Payment confirmation is intentionally NOT a management action: only a
// server-verified payment event may advance a booking to CONFIRMED.
