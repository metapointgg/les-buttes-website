import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';

const now=1800000000;
const identity={role:'owner',subject:'lb08-acceptance-owner'};
const id=randomUUID();
const booking=()=>({
  PK:'BOOKING#'+id,SK:'META',id,source:'direct',GSI1PK:'BOOKING_REQUESTS',
  status:'REQUESTED',reservationStatus:'PENDING_REVIEW',
  units:['geranium'],start:'2027-07-03',end:'2027-07-10',
  holdExpiresAt:now+3600,quote:{totalGBP:1085}
});
function harness(record=booking()){
 const commands=[];
 const db={send:async cmd=>{commands.push(cmd);return {};}};
 const run=(action,extra={})=>executeOwnerTransition({
  db,table:'isolated-test-only',readBooking:async()=>record,
  identity,bookingId:id,action,nowEpoch:now,...extra
 });
 return {commands,run};
}
test('A09 owner approval is one atomic transaction with seven extended holds and audit',async()=>{
 const {commands,run}=harness();
 const result=await run('approve',{approval:{usePublishedQuote:true}});
 assert.equal(result.to,'APPROVED_AWAITING_PAYMENT');
 assert.equal(result.affectedNights,7);
 assert.equal(commands.length,1);
 const items=commands[0].input.TransactItems;
 assert.equal(items.length,9);
 assert.equal(items[0].Update.ExpressionAttributeValues[':amount'],1085);
 assert.equal(items[0].Update.ExpressionAttributeValues[':nextExpiry'],now+48*3600);
 assert.equal(items.filter(x=>x.Update?.Key?.PK==='UNIT#geranium').length,7);
 assert.equal(items.at(-1).Put.Item.action,'approve');
 assert.match(items[0].Update.ConditionExpression,/holdExpiresAt > :now/);
});
test('A09 owner rejection atomically releases all seven holds and audits decision',async()=>{
 const {commands,run}=harness();
 const result=await run('decline');
 assert.equal(result.to,'DECLINED');
 const items=commands[0].input.TransactItems;
 assert.equal(items.length,9);
 assert.equal(items.filter(x=>x.Delete).length,7);
 assert.equal(items.at(-1).Put.Item.action,'decline');
});
for(const [name,record,action,extra] of [
 ['expired hold',{...booking(),holdExpiresAt:now},'approve',{approval:{usePublishedQuote:true}}],
 ['imported reservation',{...booking(),source:'airbnb'},'decline',{}],
 ['already approved booking',{...booking(),status:'APPROVED_AWAITING_PAYMENT'},'approve',{approval:{usePublishedQuote:true}}],
 ['missing quote',{...booking(),quote:null},'approve',{approval:{usePublishedQuote:true}}]
]){
 test('A09 refuses '+name+' without writing',async()=>{
  const {commands,run}=harness(record);
  await assert.rejects(run(action,extra));
  assert.equal(commands.length,0);
 });
}
test('A09 refuses unauthorised identity before reading a booking',async()=>{
 let read=false;
 await assert.rejects(executeOwnerTransition({
  db:{send:async()=>{throw Error('unexpected write');}},
  table:'isolated-test-only',readBooking:async()=>{read=true;return booking();},
  identity:{role:'guest'},bookingId:id,action:'approve',nowEpoch:now,
  approval:{usePublishedQuote:true}
 }),/Forbidden/);
 assert.equal(read,false);
});
test('A09 never accepts an injected payment URL',async()=>{
 const {commands,run}=harness();
 await assert.rejects(run('approve',{approval:{amountPence:108500,paymentUrl:'https://example.invalid/pay'}}),/payment URL/);
 assert.equal(commands.length,0);
});

test('A09 cancellation transaction never includes unused :now and releases seven nights',async()=>{
 const record={...booking(),status:'CONFIRMED',reservationStatus:'CONFIRMED'};
 const {commands,run}=harness(record);
 const result=await run('cancel',{reason:'Guest cancellation requested'});
 assert.equal(result.to,'CANCELLED');
 assert.equal(commands.length,1);
 const items=commands[0].input.TransactItems;
 assert.equal(items.length,9);
 assert.equal(items.filter(x=>x.Delete).length,7);
 assert.equal(Object.hasOwn(items[0].Update.ExpressionAttributeValues,':now'),false);
 assert.match(items[0].Update.UpdateExpression,/cancelReason = :reason/);
 assert.equal(items.at(-1).Put.Item.reason,'Guest cancellation requested');
});
