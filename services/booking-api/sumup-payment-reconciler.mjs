// LB-08: staging-only, fail-closed payment reconciliation. No HTTP route.
import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {verifySumUpPayment} from './sumup-payment-verification.mjs';
import {preparePaymentConfirmation} from './sumup-payment-confirmation.mjs';

const BOOKING_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function reconcileVerifiedPayment({db,table,bookingId,fetchCheckout,merchantCode,
 nowEpoch=Math.floor(Date.now()/1000)}={}){
 if(!db?.send||typeof table!=='string'||!table.toLowerCase().includes('staging')||
   !BOOKING_ID.test(bookingId??'')||typeof fetchCheckout!=='function'||
   typeof merchantCode!=='string'||!merchantCode.trim()||
   !Number.isSafeInteger(nowEpoch)||nowEpoch<0)
  throw Error('Staging payment reconciler is not configured');
 const key={PK:'BOOKING#'+bookingId,SK:'META'};
 // Both local records are read consistently; neither webhook nor browser data supplies payment status.
 const booking=(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const registered=await readRegisteredCheckout({db,table,bookingId});
 if(!booking||!registered)throw Error('Authoritative booking or checkout missing');
 if(registered.bookingId!==bookingId||registered.currency!=='GBP'||
   registered.status!=='PENDING')throw Error('Registered checkout not eligible');
 // Merchant configuration is trusted server-side; never sourced from the callback.
 const provider=await fetchCheckout(registered.checkoutId);
 const evidence=verifySumUpPayment({registered:{...registered,merchantCode},provider,booking,
  now:new Date(nowEpoch*1000)});
 if(!evidence.verified)throw Error('Payment not verified: '+evidence.reason);
 const prepared=preparePaymentConfirmation({booking,registered,evidence,nowEpoch});
 const items=prepared.items.map(item=>{
  const kind=Object.keys(item)[0];
  return {[kind]:{...item[kind],TableName:table}};
 });
 // A retry after a lost response will fail its conditions; it must not emit another audit entry.
 // No ambiguous transaction cancellation is treated as success without an authoritative reread.
 await db.send(new TransactWriteCommand({TransactItems:items,
  ClientRequestToken:prepared.eventId}));
 return {status:'CONFIRMED',bookingId,transactionId:evidence.transactionId,
  affectedNights:prepared.affectedNights,auditId:prepared.eventId};
}
