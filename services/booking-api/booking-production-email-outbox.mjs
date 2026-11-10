import {PutCommand,GetCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {emailOutboxKey} from './booking-email-outbox.mjs';
import {validateProductionSesMessage} from './booking-production-ses-policy.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
export async function sendProductionBookingEmailOnce({db,table,transport,env=process.env,message,
 now=()=>new Date().toISOString()}={}){
 if(!db?.send||!transport?.send||!TABLE.test(table??'')||env.BOOKING_ENVIRONMENT!=='production')
  throw Error('Production outbox unavailable');
 const verdict=validateProductionSesMessage({...message,env});
 if(!verdict.allowed)throw Error('Production email not authorised: '+verdict.failures.join('; '));
 const key=emailOutboxKey(message),timestamp=now();
 if(typeof timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(timestamp))throw Error('Invalid outbox timestamp');
 const record={...key,bookingId:message.bookingId,type:message.type,templateId:message.templateId,
  to:verdict.recipient,sender:verdict.sender,state:'CLAIMED',claimedAt:timestamp};
 try{
  await db.send(new PutCommand({TableName:table,Item:record,
   ConditionExpression:'attribute_not_exists(PK) AND attribute_not_exists(SK)'}));
 }catch(error){
  if(error?.name!=='ConditionalCheckFailedException')throw error;
  const existing=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}));
  if(!existing.Item)throw Error('Email outbox claim inconsistent; manual reconciliation required');
  return {status:'ALREADY_CLAIMED',state:existing.Item.state,bookingId:message.bookingId,
   type:message.type,templateId:message.templateId};
 }
 try{
  const receipt=await transport.send(message);
  if(receipt?.status!=='ACCEPTED_BY_SES_NOT_DELIVERED'||typeof receipt.messageId!=='string'||!receipt.messageId.trim())
   throw Error('SES acknowledgement unavailable');
  await db.send(new UpdateCommand({TableName:table,Key:key,
   UpdateExpression:'SET #state = :accepted, sesMessageId = :messageId, acceptedAt = :at',
   ConditionExpression:'#state = :claimed',ExpressionAttributeNames:{'#state':'state'},
   ExpressionAttributeValues:{':accepted':'ACCEPTED_BY_SES_NOT_DELIVERED',':claimed':'CLAIMED',
    ':messageId':receipt.messageId,':at':now()}}));
  return {status:'ACCEPTED_BY_SES_NOT_DELIVERED',messageId:receipt.messageId,
   bookingId:message.bookingId,type:message.type,templateId:message.templateId};
 }catch{
  try{await db.send(new UpdateCommand({TableName:table,Key:key,
   UpdateExpression:'SET #state = :unknown, reconciliationRequiredAt = :at',
   ConditionExpression:'#state = :claimed',ExpressionAttributeNames:{'#state':'state'},
   ExpressionAttributeValues:{':unknown':'RECONCILIATION_REQUIRED',':claimed':'CLAIMED',':at':now()}}));}catch{}
  throw Error('SES delivery outcome uncertain; manual reconciliation required');
 }
}
