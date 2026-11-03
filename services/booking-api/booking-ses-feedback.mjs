// LB-09 SES delivery feedback reconciler. Not an HTTP/SNS Lambda endpoint.
// Call only with an independently authenticated provider envelope; never trust raw JSON.
// Feedback updates the durable outbox but cannot send a message or mutate a booking.
import {GetCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {emailOutboxKey} from './booking-email-outbox.mjs';

const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const EVENT_TYPES={Delivery:'DELIVERED',Bounce:'BOUNCED',Complaint:'COMPLAINED'};
const terminal=new Set(['BOUNCED','COMPLAINED']);
function tagged(mail,name){
 const values=mail?.tags?.[name];
 return Array.isArray(values)&&values.length===1&&typeof values[0]==='string'?values[0]:null;
}
export function parseSesFeedback(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    !Object.hasOwn(EVENT_TYPES,payload.eventType))
  throw Error('Unsupported SES event');
 const mail=payload.mail;
 const messageId=mail?.messageId,bookingId=tagged(mail,'bookingId'),
  type=tagged(mail,'emailType'),templateId=tagged(mail,'templateId');
 const key=emailOutboxKey({bookingId,type,templateId});
 if(typeof messageId!=='string'||messageId.length<6||messageId.length>300||
    !Array.isArray(mail?.destination)||mail.destination.length!==1||
    typeof mail.destination[0]!=='string')
  throw Error('Invalid SES message identity');
 const recipient=mail.destination[0].trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
  throw Error('Invalid SES destination');
 return {key,bookingId,type,templateId,messageId,recipient,
  state:EVENT_TYPES[payload.eventType]};
}
export async function reconcileAuthenticatedSesFeedback({
 db,table,notification,verifyEnvelope,now=()=>new Date().toISOString()
}={}){
 if(!db?.send||!TABLE.test(table??'')||typeof verifyEnvelope!=='function')
  throw Error('Staging SES feedback unavailable');
 // A caller-supplied 'verified' flag is NOT sufficient. A trusted SNS signature
 // validator is required before parsing Notification.Message.
 if(!notification||typeof notification!=='object'||
    notification.Type!=='Notification'||typeof notification.Message!=='string'||
    !(await verifyEnvelope(notification)))
  throw Error('Unverified SES event envelope');
 let payload;
 try{payload=JSON.parse(notification.Message);}catch{throw Error('Malformed SES event');}
 const event=parseSesFeedback(payload);
 const record=(await db.send(new GetCommand({TableName:table,Key:event.key,
  ConsistentRead:true}))).Item;
 if(!record||record.sesMessageId!==event.messageId||
    record.to!==event.recipient||record.bookingId!==event.bookingId||
    record.type!==event.type||record.templateId!==event.templateId)
  throw Error('SES feedback cannot be matched to authoritative outbox');
 const previous=record.state;
 if(terminal.has(previous)||previous===event.state)
  return {status:'IGNORED_ALREADY_RECONCILED',state:previous};
 if(previous!=='ACCEPTED_BY_SES_NOT_DELIVERED'&&previous!=='DELIVERED')
  throw Error('SES feedback requires a recorded provider acceptance');
 if(previous==='DELIVERED'&&event.state==='DELIVERED')
  return {status:'IGNORED_ALREADY_RECONCILED',state:previous};
 const timestamp=now();
 if(typeof timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(timestamp))
  throw Error('Invalid reconciliation timestamp');
 try{
  await db.send(new UpdateCommand({TableName:table,Key:event.key,
   UpdateExpression:'SET #state = :next, feedbackAt = :now',
   ConditionExpression:'#state = :previous AND sesMessageId = :messageId AND #recipient = :recipient',
   ExpressionAttributeNames:{'#state':'state','#recipient':'to'},
   ExpressionAttributeValues:{':next':event.state,':previous':previous,
    ':messageId':event.messageId,':recipient':event.recipient,':now':timestamp}}));
 }catch(error){
  if(error?.name==='ConditionalCheckFailedException')
   return {status:'CONCURRENT_RECONCILIATION',state:null};
  throw error;
 }
 return {status:'UPDATED',state:event.state,bookingId:event.bookingId};
}
