// Technical refund acceptance only. No live or published cancellation policy is implied.
import {GetCommand,PutCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient} from '@aws-sdk/client-ssm';
import {loadSandboxSumUpCredentials,checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
export async function sandboxRefund({db,bookingId,env=process.env,fetchImpl=fetch,ssm=new SSMClient({region:'eu-west-2'}),verifyMerchant=checkSandboxSumUpConnectivity,loadCredentials=loadSandboxSumUpCredentials}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||env.BOOKING_SANDBOX_REFUND_ACCEPTANCE!=='true'||!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(env.BOOKINGS_TABLE??'')||!UUID.test(bookingId??''))throw Error('Sandbox refund acceptance disabled');
 const table=env.BOOKINGS_TABLE;
 const get=async SK=>(await db.send(new GetCommand({TableName:table,Key:{PK:'BOOKING#'+bookingId,SK},ConsistentRead:true}))).Item;
 const booking=await get('META'),checkout=await get('PAYMENT#CHECKOUT');
 if(booking?.synthetic!==true||booking.guestEmail!=='test@example.invalid'||booking.status!=='CANCELLED'||booking.source!=='direct'||!UUID.test(booking.paymentTransactionId??'')||checkout?.currency!=='GBP'||!Number.isSafeInteger(checkout.amountPence)||checkout.amountPence<=0||Math.round(Number(booking.approvedAmountGBP)*100)!==checkout.amountPence)throw Error('Cancelled paid synthetic booking required');
 const transactionId=booking.paymentTransactionId;
 const claim=(await db.send(new GetCommand({TableName:table,Key:{PK:'PAYMENT_TRANSACTION#'+transactionId,SK:'CONFIRMATION'},ConsistentRead:true}))).Item;
 if(claim?.bookingId!==bookingId||claim.checkoutId!==checkout.checkoutId||claim.amountPence!==checkout.amountPence)throw Error('Verified payment claim required');
 const merchant=await verifyMerchant({ssm,region:'eu-west-2'});
 if(!merchant.sandboxVerified||!merchant.merchantMatched)throw Error('Sandbox merchant required');
 const {apiKey,merchantCode}=await loadCredentials({ssm,region:'eu-west-2'});
 const headers={Authorization:'Bearer '+apiKey,'Content-Type':'application/json'};
 const read=async()=>{
  const r=await fetchImpl('https://api.sumup.com/v2.1/merchants/'+encodeURIComponent(merchantCode)+'/transactions?id='+transactionId,{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Provider transaction read failed: '+r.status);
  const t=await r.json();
  if(t.id!==transactionId||t.merchant_code!==merchantCode||t.currency!=='GBP'||Math.round(Number(t.amount)*100)!==checkout.amountPence)throw Error('Provider transaction identity or amount mismatch');
  // Transaction detail exposes refund events, not the list endpoint's refunded_amount.
  const events=Array.isArray(t.transaction_events)?t.transaction_events:t.events;
  if(!Array.isArray(events))throw Error('Provider refund events unavailable');
  const refunds=events.filter(e=>(e.event_type??e.type)==='REFUND');
  if(refunds.some(e=>!Number.isFinite(e.amount)||e.amount<=0))throw Error('Invalid provider refund amount');
  t.refundPending=refunds.some(e=>!['REFUNDED','SUCCESSFUL','FAILED'].includes(e.status));
  t.refundedPence=refunds.filter(e=>['REFUNDED','SUCCESSFUL'].includes(e.status)).reduce((n,e)=>n+Math.round(e.amount*100),0);
  return t;
 };
 const before=await read(),key={PK:'BOOKING#'+bookingId,SK:'REFUND#SANDBOX_ACCEPTANCE_V1'};
 const existing=await get(key.SK);
 let requested=false;
 if(!existing){
  if(before.status!=='SUCCESSFUL'||before.refundedPence!==0||before.refundPending)throw Error('Fresh refundable sandbox payment required');
  // Synthetic 100% / zero-fee fixture only. Never publish this as business policy.
  await db.send(new PutCommand({TableName:table,Item:{...key,bookingId,transactionId,amountPence:checkout.amountPence,policyId:'SYNTHETIC_FULL_REFUND_V1',refundBasisPoints:10000,feePence:0,state:'REQUESTED',createdAt:new Date().toISOString()},ConditionExpression:'attribute_not_exists(PK)'}));
  try{
   const response=await fetchImpl('https://api.sumup.com/v1.0/merchants/'+encodeURIComponent(merchantCode)+'/payments/'+transactionId+'/refunds',{method:'POST',headers,body:JSON.stringify({amount:checkout.amountPence/100}),signal:AbortSignal.timeout(12000)});
   requested=true;
   if(!response.ok)throw Error('Provider refund rejected: '+response.status);
  }catch(error){
   // Durable claim prevents another POST after any ambiguous outcome.
   await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET #s = :s',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':s':'RECONCILIATION_REQUIRED'}}));
   throw error;
  }
 }else if(existing.transactionId!==transactionId||existing.amountPence!==checkout.amountPence||existing.policyId!=='SYNTHETIC_FULL_REFUND_V1')throw Error('Refund claim mismatch');
 const after=await read();
 if(after.refundedPence!==checkout.amountPence||after.refundPending||after.status!=='REFUNDED'){
  await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET #s = :s, providerStatus = :p, verifiedRefundPence = :a, checkedAt = :at',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':s':'RECONCILIATION_REQUIRED',':p':after.status,':a':after.refundedPence,':at':new Date().toISOString()}}));
  return {status:'RECONCILIATION_REQUIRED',bookingId,refundPostAttempted:requested,providerStatus:after.status,verifiedRefundPence:after.refundedPence,refundPending:after.refundPending};
 }
 await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET #s = :s, verifiedAt = :at',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':s':'REFUNDED',':at':new Date().toISOString()}}));
 return {status:requested?'REFUNDED':'ALREADY_REFUNDED',bookingId,amountPence:checkout.amountPence,syntheticPolicy:true,refundPostAttempted:requested};
}
