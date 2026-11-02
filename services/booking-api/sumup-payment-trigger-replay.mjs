// LB-08: immutable replay claim for authenticated internal payment triggers.
// This module is not a SumUp webhook receiver or an HTTP route.
import {createHash} from 'node:crypto';
import {PutCommand} from '@aws-sdk/lib-dynamodb';
export async function claimInternalPaymentTrigger({db,table,body,nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||typeof table!=='string'||!table.toLowerCase().includes('staging')||
  typeof body!=='string'||Buffer.byteLength(body)>2048||!Number.isSafeInteger(nowEpoch)||nowEpoch<0)
  throw Error('Staging replay protection unavailable');
 const hash=createHash('sha256').update(body,'utf8').digest('hex');
 const item={PK:'PAYMENT_TRIGGER#'+hash,SK:'INTERNAL',receivedAt:new Date(nowEpoch*1000).toISOString(),
  expiresAt:nowEpoch+86400};
 // Conditional write prevents two concurrent invocations processing the same message.
 // Persist the claim before reconciliation; an uncertain failure requires operator review
 // rather than a fresh automatic retry. TTL removes old claims asynchronously.
 await db.send(new PutCommand({TableName:table,Item:item,
  ConditionExpression:'attribute_not_exists(PK)'}));
 return {claimed:true,triggerHash:hash};
}
