// LB-08: pure verification of independently retrieved SumUp checkout state.
// Does not update bookings, trust browser redirects, or accept webhook assertions.
const ID=/^[A-Za-z0-9-]{8,100}$/;
const REF=/^[A-Za-z0-9_-]{6,64}$/;
const TX=/^[A-Za-z0-9_-]{6,128}$/;
export function verifySumUpPayment({registered,provider,booking,now=new Date()}={}){
 const fail=reason=>({verified:false,reason});
 if(!registered||!provider||!booking)return fail('Missing independent payment evidence');
 if(!ID.test(registered.checkoutId??'')||!REF.test(registered.reference??''))
  return fail('Invalid registered checkout identity');
 if(provider.id!==registered.checkoutId||provider.checkout_reference!==registered.reference)
  return fail('Checkout identity mismatch');
 if(provider.merchant_code!==registered.merchantCode||typeof registered.merchantCode!=='string')
  return fail('Merchant identity mismatch');
 if(provider.currency!=='GBP'||registered.currency!=='GBP')
  return fail('Currency mismatch');
 const expected=registered.amountPence;
 const actual=Number(provider.amount);
 if(!Number.isSafeInteger(expected)||expected<1||!Number.isFinite(actual)||
    Math.round(actual*100)!==expected||Math.abs(actual*100-expected)>0.000001)
  return fail('Amount mismatch');
 if(booking.id!==registered.bookingId||booking.source!=='direct'||
   booking.reservationStatus!=='AWAITING_PAYMENT')
  return fail('Booking state mismatch');
 if(!Number.isFinite(Number(booking.approvedAmountGBP))||
   Math.round(Number(booking.approvedAmountGBP)*100)!==expected)
  return fail('Approved amount mismatch');
 if(provider.status!=='PAID')return fail('Provider has not confirmed payment');
 // Provider transaction must be independently returned by the checkout read.
 // A webhook event or redirect alone is not payment evidence.
 const tx=provider.transactions;
 if(!Array.isArray(tx)||tx.length!==1||tx[0]?.status!=='SUCCESSFUL'||
    !TX.test(tx[0]?.id??''))return fail('Successful provider transaction missing or ambiguous');
 if(!(now instanceof Date)||Number.isNaN(now.getTime()))return fail('Invalid verification time');
 return {verified:true,checkoutId:registered.checkoutId,bookingId:booking.id,
   reference:registered.reference,amountPence:expected,currency:'GBP',
   transactionId:tx[0].id,verifiedAt:now.toISOString()};
}
