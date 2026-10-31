// Pure transaction preconditions for future management writes.
// Never call this a substitute for DynamoDB conditional writes.
import {checkOwnerAction} from './booking-admin-action-policy.mjs';
export function prepareOwnerTransition({identity,action,booking,reason,nowEpoch=Math.floor(Date.now()/1000)}={}){
 const decision=checkOwnerAction({identity,action,booking,reason,nowEpoch});
 if(!decision.allowed)return decision;
 if(typeof booking.id!=='string'||!/^[0-9a-f-]{36}$/i.test(booking.id))
   return {allowed:false,reason:'Invalid booking reference'};
 if(!Array.isArray(booking.units)||booking.units.length<1||
    booking.units.length>2||new Set(booking.units).size!==booking.units.length||
    booking.units.some(u=>!['geranium','honeysuckle'].includes(u)))
   return {allowed:false,reason:'Invalid cottage allocation'};
 const start=Date.parse(booking.start+'T00:00:00Z');
 const end=Date.parse(booking.end+'T00:00:00Z');
 const nights=(end-start)/86400000;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(booking.start)||!/^\d{4}-\d{2}-\d{2}$/.test(booking.end)||
    !Number.isInteger(nights)||nights<1||nights>27||
    new Date(start).toISOString().slice(0,10)!==booking.start||
    new Date(end).toISOString().slice(0,10)!==booking.end)
   return {allowed:false,reason:'Invalid stay dates'};
 const slots=booking.units.flatMap(unit=>Array.from({length:nights},(_,i)=>({
   PK:'UNIT#'+unit,SK:'DATE#'+new Date(start+i*86400000).toISOString().slice(0,10)
 })));
 // Metadata plus every cottage-night must fit in one DynamoDB transaction.
 if(slots.length+1>100)return {allowed:false,reason:'Transaction exceeds DynamoDB limit'};
 return {...decision,slots,metadataKey:{PK:'BOOKING#'+booking.id,SK:'META'},nowEpoch};
}
