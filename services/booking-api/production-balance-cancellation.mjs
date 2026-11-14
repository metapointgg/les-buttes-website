// Before a deposit booking is cancelled, ensure the separate balance checkout
// cannot accept payment. Writer must atomically assert the creation-claim or
// checkout state so a racing checkout registration cannot escape cancellation.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
const key=(id,sk)=>({PK:'BOOKING#'+id,SK:sk});
export async function verifyBalanceCheckoutDeactivated({db,table,booking,sumup}={}){
 if(!db?.send||!table||booking?.paymentStatus!=='PARTIALLY_PAID'||
   !Number.isSafeInteger(booking.balanceDuePence)||booking.balanceDuePence<1)
  throw Error('Partial-payment cancellation requires verified balance state');
 const {Item:claim}=await db.send(new GetCommand({TableName:table,
  Key:key(booking.id,'PAYMENT#BALANCE_CREATION_CLAIM'),ConsistentRead:true}));
 const {Item:checkout}=await db.send(new GetCommand({TableName:table,
  Key:key(booking.id,'PAYMENT#BALANCE_CHECKOUT'),ConsistentRead:true}));
 if(!checkout){
  if(claim)throw Error('Uncertain balance checkout creation must be reviewed before cancellation');
  return {state:'NO_LINK',verified:true};
 }
 if(!claim||claim.reference!==checkout.reference||claim.amountPence!==checkout.amountPence||
    checkout.bookingId!==booking.id||checkout.status!=='PENDING'||
    checkout.amountPence!==booking.balanceDuePence||checkout.currency!=='GBP')
  throw Error('Balance checkout and claim identity mismatch');
 if(!sumup?.retrieveCheckout||!sumup?.deactivateCheckout||
    sumup.merchantCode!=='M9BE4KMN')throw Error('Verified SumUp client required');
 const matches=remote=>remote?.id===checkout.checkoutId&&
  remote.checkout_reference===checkout.reference&&remote.merchant_code===sumup.merchantCode&&
  remote.currency==='GBP'&&Math.round(Number(remote.amount)*100)===checkout.amountPence&&
  (!Array.isArray(remote.transactions)||
    !remote.transactions.some(x=>x.status==='SUCCESSFUL'||x.status==='PAID'));
 const before=await sumup.retrieveCheckout(checkout.checkoutId);
 if(!matches(before)||!['PENDING','EXPIRED'].includes(before.status))
  throw Error('Balance payment may have been completed; dates must remain reserved');
 if(before.status==='PENDING')await sumup.deactivateCheckout(checkout.checkoutId);
 const after=await sumup.retrieveCheckout(checkout.checkoutId);
 if(!matches(after)||after.status!=='EXPIRED')
  throw Error('Independent provider expiry confirmation required');
 return {state:'EXPIRED',verified:true,checkoutId:checkout.checkoutId,
  reference:checkout.reference,amountPence:checkout.amountPence};
}
