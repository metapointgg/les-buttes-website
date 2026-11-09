// LB-07: atomic per-booking checkout creation claim.
// Claim must be acquired before any external SumUp create call.
// Uncertain provider responses are NOT safe to retry automatically.
import {PutCommand,GetCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f-]{36}$/i;
export function creationClaimKey(bookingId){
 if(!UUID.test(bookingId??''))throw Error('Invalid booking ID');
 return {PK:'BOOKING#'+bookingId,SK:'PAYMENT#CREATION_CLAIM'};
}
export async function acquireCreationClaim({db,table,bookingId,reference,amountPence,actor}={}){
 if(!db?.send||!table?.toLowerCase().includes('staging'))throw Error('Staging checkout claim unavailable');
 if(typeof reference!=='string'||!/^lb-[a-f0-9]{32}$/.test(reference)||
   !Number.isSafeInteger(amountPence)||amountPence<1||
   typeof actor!=='string'||!actor.trim())throw Error('Invalid creation claim');
 const claimId=randomUUID();
 const item={...creationClaimKey(bookingId),claimId,reference,amountPence,
  status:'CREATING',actor,createdAt:new Date().toISOString()};
 await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(PK)'}));
 return item;
}
export async function readCreationClaim({db,table,bookingId}={}){
 if(!db?.send||!table)throw Error('Checkout claim reader unavailable');
 return (await db.send(new GetCommand({TableName:table,Key:creationClaimKey(bookingId),ConsistentRead:true}))).Item??null;
}
export async function markCreationClaimForReconciliation({db,table,bookingId,claimId,checkoutId=null}={}){
 if(!db?.send||!table?.toLowerCase().includes('staging'))throw Error('Staging checkout claim unavailable');
 if(typeof claimId!=='string'||!UUID.test(claimId)||checkoutId!==null&&
   (typeof checkoutId!=='string'||!/^[A-Za-z0-9-]{8,100}$/.test(checkoutId)))
  throw Error('Invalid checkout claim identity');
 const values={':id':claimId,':creating':'CREATING',':reconcile':'RECONCILE_REQUIRED',
  ':updatedAt':new Date().toISOString()};
 let update='SET #status = :reconcile, updatedAt = :updatedAt';
 if(checkoutId){update+=', checkoutId = :checkoutId';values[':checkoutId']=checkoutId;}
 await db.send(new UpdateCommand({TableName:table,Key:creationClaimKey(bookingId),
  UpdateExpression:update,ConditionExpression:'claimId = :id AND #status = :creating',
  ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:values}));
}
