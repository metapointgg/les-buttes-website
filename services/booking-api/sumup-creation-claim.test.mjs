import test from 'node:test';import assert from 'node:assert/strict';
import {acquireCreationClaim,readCreationClaim,markCreationClaimForReconciliation} from './sumup-creation-claim.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
test('LB-07 claim is permanent, atomic and uniquely identifies booking',async()=>{
 let put;
 const db={send:async cmd=>{put=cmd.input;return {};}};
 const claim=await acquireCreationClaim({db,table:'booking-staging',bookingId,
  reference:'lb-12345678901234567890123456789012',amountPence:150000,actor:'owner'});
 assert.equal(claim.status,'CREATING');
 assert.equal(put.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(put.Item.PK,'BOOKING#'+bookingId);
 assert.equal(put.Item.SK,'PAYMENT#CREATION_CLAIM');
 assert.equal(put.Item.expiresAt,undefined);
 await markCreationClaimForReconciliation({db,table:'booking-staging',bookingId,claimId:claim.claimId});
 assert.match(put.ConditionExpression,/claimId = :id/);
 assert.equal(put.ExpressionAttributeValues[':reconcile'],'RECONCILE_REQUIRED');
 await assert.rejects(acquireCreationClaim({db,table:'booking-production',bookingId,
  reference:'lb-12345678901234567890123456789012',amountPence:150000,actor:'owner'}),/unavailable/);
});
test('LB-07 reads claims consistently',async()=>{
 let input;
 const db={send:async cmd=>{input=cmd.input;return {Item:{status:'CREATING'}};}};
 assert.equal((await readCreationClaim({db,table:'booking-staging',bookingId})).status,'CREATING');
 assert.equal(input.ConsistentRead,true);
});
