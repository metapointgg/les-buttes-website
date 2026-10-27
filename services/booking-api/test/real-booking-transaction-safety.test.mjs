import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePrivateTransactionPlan,classifyPrivateWriteFailure} from '../real-booking-transaction-safety.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const ref='123e4567-e89b-42d3-a456-426614174000';
function plan(){
 const put=(PK,SK,fields={},condition='attribute_not_exists(PK)')=>({Put:{
  TableName:table,Item:{PK,SK,...fields},ConditionExpression:condition}});
 const writes=[
  put('BOOKING#'+ref,'META',{id:ref,status:'REQUESTED',synthetic:false}),
  put('GUEST#'+ref,'CONTACT',{ciphertext:'encrypted-placeholder',keyType:'AWS_KMS'}),
  put('IDEMPOTENCY#abc','REQUEST'),
  put('UNIT#geranium','DATE#2027-07-10',{id:ref,expiresAt:12345678},
   'attribute_not_exists(PK) OR (attribute_exists(expiresAt) AND expiresAt < :now)')
 ];
 return {mode:'DRY_RUN_ONLY',reference:ref,slotCount:1,totalGBP:155,
  transactWrite:{TransactItems:writes,ClientRequestToken:ref}};
}
test('private transaction validator accepts staging-only conditional plans',()=>{
 assert.deepEqual(validatePrivateTransactionPlan(plan(),table),{
  mode:'DRY_RUN_ONLY',reference:ref,slotCount:1,recordCount:4,quotedGBP:155
 });
});
test('rejects production table, leaked PII, missing locks and mismatched identities',()=>{
 const variants=[
  p=>p.transactWrite.TransactItems[0].Put.Item.guestEmail='person@example.invalid',
  p=>p.transactWrite.TransactItems[3].Put.ConditionExpression='attribute_exists(PK)',
  p=>p.transactWrite.TransactItems[2].Put.ConditionExpression='attribute_exists(PK)',
  p=>p.transactWrite.ClientRequestToken='different',
  p=>p.transactWrite.TransactItems[1].Put.Item.ciphertext='',
  p=>p.transactWrite.TransactItems[3].Put.TableName='production'
 ];
 assert.throws(()=>validatePrivateTransactionPlan(plan(),'production'));
 for(const change of variants){const p=plan();change(p);assert.throws(()=>validatePrivateTransactionPlan(p,table));}
});
test('transaction failures are classified without exposing sensitive diagnostics',()=>{
 const failure={name:'TransactionCanceledException',message:'Private guest alice@example.com'};
 const result=classifyPrivateWriteFailure(failure);
 assert.equal(result.status,409);
 assert.ok(!JSON.stringify(result).includes('alice@example.com'));
 assert.equal(classifyPrivateWriteFailure({name:'InternalServerError'}).status,503);
});
