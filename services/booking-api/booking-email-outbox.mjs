// LB-09: durable staging outbox. Repeated booking events must never send twice.
// An uncertain failure is reconciled manually; automatic retries risk duplicate guest mail.
import {PutCommand,GetCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {validateStagingSesMessage} from './booking-staging-ses-policy.mjs';

const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const SK=/^[a-z0-9][a-z0-9_-]{1,80}$/;
export function emailOutboxKey({bookingId,type,templateId}){
 if(typeof bookingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(bookingId)||
    !SK.test(type??'')||!SK.test(templateId??''))
  throw Error('Invalid email outbox identity');
 return {PK:'BOOKING#'+bookingId,SK:'EMAIL#'+type+'#'+templateId};
}
export async function sendBookingEmailOnce({
 db,table,transport,env=process.env,message,now=()=>new Date().toISOString()
}={}){
 if(!db?.send||!transport?.send||!TABLE.test(table??'')||
    env.BOOKING_ENVIRONMENT!=='staging')
  throw Error('Staging outbox unavailable');
 const verdict=validateStagingSesMessage({...message,env});
 if(!verdict.allowed)throw Error('Staging email not authorised: '+verdict.failures.join('; '));
 const key=emailOutboxKey(message);
 const timestamp=now();
 if(typeof timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(timestamp))
  throw Error('Invalid outbox timestamp');
 const record={...key,bookingId:message.bookingId,type:message.type,
  templateId:message.templateId,to:verdict.recipient,sender:verdict.sender,
  state:'CLAIMED',claimedAt:timestamp};
 // Claim is permanent: no automatic release on exception, timeout or unknown SES response.
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
  if(receipt?.status!=='ACCEPTED_BY_SES_NOT_DELIVERED'||
     typeof receipt.messageId!=='string'||!receipt.messageId.trim())
   throw Error('SES acknowledgement unavailable');
  // Conditional status update: manual reconciliation on any ambiguity.
  await db.send(new UpdateCommand({TableName:table,Key:key,
   UpdateExpression:'SET #state = :accepted, sesMessageId = :messageId, acceptedAt = :at',
   ConditionExpression:'#state = :claimed',
   ExpressionAttributeNames:{'#state':'state'},
   ExpressionAttributeValues:{':accepted':'ACCEPTED_BY_SES_NOT_DELIVERED',
    ':claimed':'CLAIMED',':messageId':receipt.messageId,':at':now()}}));
  return {status:'ACCEPTED_BY_SES_NOT_DELIVERED',messageId:receipt.messageId,
   bookingId:message.bookingId,type:message.type,templateId:message.templateId};
 }catch(error){
  // We cannot prove whether SES accepted an attempted send. Do not clear the claim.
  // If updating the claim also fails, it remains CLAIMED and blocks any duplicate.
  try{
   await db.send(new UpdateCommand({TableName:table,Key:key,
    UpdateExpression:'SET #state = :unknown, reconciliationRequiredAt = :at',
    ConditionExpression:'#state = :claimed',
    ExpressionAttributeNames:{'#state':'state'},
    ExpressionAttributeValues:{':unknown':'RECONCILIATION_REQUIRED',':claimed':'CLAIMED',
     ':at':now()}}));
  }catch{/* retain permanent claim; never resend */ }
  throw Error('SES delivery outcome uncertain; manual reconciliation required');
 }
}
