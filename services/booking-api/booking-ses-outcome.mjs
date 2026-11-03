// LB-09: SES delivery outcomes on previously claimed staging outbox records.
// This module is NOT an SNS handler and does NOT authenticate incoming messages.
// Call it only from a future adapter that validates AWS SNS signing certificate,
// signature, TopicArn, account, region, subscription, message size and freshness.
// Never use unverified SES events or email outcomes to change booking payment state.
import {UpdateCommand} from '@aws-sdk/lib-dynamodb';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const KEY=/^EMAIL#(?:approval_payment|declined|confirmed|cancelled|hold_expired|delivery_failure)#[a-z0-9][a-z0-9_-]{1,80}$/;
const STATUS=Object.freeze({Delivery:'DELIVERED',Bounce:'BOUNCED',Complaint:'COMPLAINED'});
const ALLOWED={
 ACCEPTED_BY_SES_NOT_DELIVERED:new Set(['DELIVERED','BOUNCED','COMPLAINED']),
 DELIVERED:new Set(['BOUNCED','COMPLAINED'])
};
export function classifyVerifiedSesOutcome({notification,outbox}={}){
 if(!notification||!outbox||typeof notification!=='object'||
    typeof notification.mail?.messageId!=='string'||
    notification.mail.messageId!==outbox.sesMessageId||
    !KEY.test(outbox.SK??'')||
    !/^BOOKING#[0-9a-f-]{36}$/i.test(outbox.PK??''))
  throw Error('Unmatched SES notification or outbox');
 const eventType=notification.eventType??notification.notificationType;
 if(!Object.hasOwn(STATUS,eventType))throw Error('Unsupported SES outcome');
 const destination=notification.mail.destination;
 if(!Array.isArray(destination)||destination.length!==1||
    typeof outbox.to!=='string'||destination[0]?.toLowerCase()!==outbox.to.toLowerCase())
  throw Error('SES recipient mismatch');
 if(eventType==='Bounce'&&(!notification.bounce||
    !['Permanent','Transient','Undetermined'].includes(notification.bounce.bounceType)))
  throw Error('Invalid SES bounce');
 if(eventType==='Complaint'&&(!notification.complaint||
    !Array.isArray(notification.complaint.complainedRecipients)||
    !notification.complaint.complainedRecipients.some(x=>
      x?.emailAddress?.toLowerCase()===outbox.to.toLowerCase())))
  throw Error('Invalid SES complaint');
 const next=STATUS[eventType],previous=outbox.state;
 if(previous===next)return {action:'DUPLICATE',status:next};
 if(!ALLOWED[previous]?.has(next))return {action:'RECONCILE',status:previous};
 return {action:'APPLY',status:next,previous};
}
export async function applyVerifiedSesOutcome({
 db,table,notification,outbox,authenticatedSns=false,now=()=>new Date().toISOString()
}={}){
 // authenticatedSns can only be asserted by a trusted, signature-verifying adapter.
 if(authenticatedSns!==true||!db?.send||!TABLE.test(table??''))
  throw Error('Verified SNS staging delivery adapter required');
 const decision=classifyVerifiedSesOutcome({notification,outbox});
 if(decision.action!=='APPLY')return decision;
 const at=now();
 if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(at))
  throw Error('Invalid delivery timestamp');
 try{
  await db.send(new UpdateCommand({
   TableName:table,Key:{PK:outbox.PK,SK:outbox.SK},
   UpdateExpression:'SET #state = :next, sesOutcomeAt = :at',
   ConditionExpression:'#state = :previous AND sesMessageId = :messageId AND #recipient = :recipient',
   ExpressionAttributeNames:{'#state':'state','#recipient':'to'},
   ExpressionAttributeValues:{':next':decision.status,':at':at,
    ':previous':decision.previous,':messageId':outbox.sesMessageId,':recipient':outbox.to}
  }));
 }catch(e){
  if(e?.name==='ConditionalCheckFailedException')
   return {action:'RECONCILE',status:decision.previous};
  throw e;
 }
 return {action:'UPDATED',status:decision.status};
}
