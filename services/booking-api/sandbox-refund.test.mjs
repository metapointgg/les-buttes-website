import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxRefund} from './sandbox-refund.mjs';
const bookingId='a6b32c40-35d6-4b07-a27f-fae2e562a736',transactionId='bc767f43-bc5d-4bdd-814c-927e8f326ec5';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'eu-west-2',BOOKING_SANDBOX_REFUND_ACCEPTANCE:'true',BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'};
function fixture(){
 let posts=0,refunded=0;const rows=new Map([
 ['META',{synthetic:true,guestEmail:'test@example.invalid',status:'CANCELLED',source:'direct',paymentTransactionId:transactionId,approvedAmountGBP:735}],
 ['PAYMENT#CHECKOUT',{checkoutId:'checkout',currency:'GBP',amountPence:73500}],
 ['CONFIRMATION',{bookingId,checkoutId:'checkout',amountPence:73500}]]);
 const db={send:async c=>{const x=c.input;if(c.constructor.name==='GetCommand')return {Item:rows.get(x.Key.SK)};if(c.constructor.name==='PutCommand'){if(rows.has(x.Item.SK))throw Error('duplicate');rows.set(x.Item.SK,x.Item);}return {};}};
 const args={db,bookingId,env,ssm:{},verifyMerchant:async()=>({sandboxVerified:true,merchantMatched:true}),loadCredentials:async()=>({apiKey:'test',merchantCode:'MTEST'}),fetchImpl:async(url,options)=>{if(options.method==='POST'){assert.deepEqual(JSON.parse(options.body),{});posts++;refunded=735;return {ok:true};}return {ok:true,json:async()=>({id:transactionId,merchant_code:'MTEST',amount:735,currency:'GBP',transaction_events:refunded?[{id:1,event_type:"REFUND",status:"REFUNDED",amount:refunded}]:[],status:refunded?'REFUNDED':'SUCCESSFUL'})};}};
 return {args,rows,get posts(){return posts;}};
}
test('sandbox full refund derives amount from verified booking and retries never POST twice',async()=>{
 const f=fixture();assert.equal((await sandboxRefund(f.args)).status,'REFUNDED');assert.equal((await sandboxRefund(f.args)).status,'ALREADY_REFUNDED');assert.equal(f.posts,1);
});
test('real identities, production and missing payment claim cannot refund',async()=>{
 for(const change of [f=>f.rows.get('META').synthetic=false,f=>f.args.env={...env,BOOKING_ENVIRONMENT:'production'},f=>f.rows.delete('CONFIRMATION')]){const f=fixture();change(f);await assert.rejects(sandboxRefund(f.args));assert.equal(f.posts,0);}
});
test('ambiguous POST retains its claim and repeat calls only reconcile',async()=>{
 const f=fixture(),fetch=f.args.fetchImpl;let posts=0;
 f.args.fetchImpl=async(u,o)=>{if(o.method==='POST'){posts++;throw Error('timeout');}return fetch(u,o);};
 await assert.rejects(sandboxRefund(f.args),/timeout/);
 assert.equal((await sandboxRefund(f.args)).status,'RECONCILIATION_REQUIRED');assert.equal(posts,1);
});
