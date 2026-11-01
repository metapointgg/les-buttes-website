// LB-07: isolated SumUp hosted-checkout client. No payment confirmation or booking writes.
const BASE='https://api.sumup.com';
const CHECKOUT='/v0.1/checkouts';
const referencePattern=/^[A-Za-z0-9_-]{6,64}$/;
export function buildCheckoutRequest({reference,amountPence,merchantCode,description='Les Buttes holiday cottage booking',validUntil,redirectUrl}={}){
 if(!referencePattern.test(reference??''))throw Error('Invalid checkout reference');
 if(!Number.isSafeInteger(amountPence)||amountPence<1||amountPence>100000000)throw Error('Invalid GBP amount');
 if(typeof merchantCode!=='string'||!/^[A-Z0-9]{6,20}$/.test(merchantCode))throw Error('Invalid merchant code');
 const body={checkout_reference:reference,amount:amountPence/100,currency:'GBP',
   merchant_code:merchantCode,description,hosted_checkout:{enabled:true}};
 if(validUntil){
  const timestamp=Date.parse(validUntil);
  if(!Number.isFinite(timestamp)||timestamp<=Date.now())throw Error('Invalid expiry');
  body.valid_until=new Date(timestamp).toISOString();
 }
 if(redirectUrl){
  const url=new URL(redirectUrl);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid redirect URL');
  body.redirect_url=url.toString();
 }
 return body;
}
export function validateCheckoutResponse(checkout,request){
 if(!checkout||typeof checkout.id!=='string'||!checkout.id||
    checkout.checkout_reference!==request.checkout_reference||
    checkout.merchant_code!==request.merchant_code||checkout.currency!=='GBP'||
    !Number.isInteger(Math.round(Number(checkout.amount)*100))||
    Math.round(Number(checkout.amount)*100)!==Math.round(request.amount*100))
   throw Error('Checkout response does not match requested booking');
 if(checkout.status!=='PENDING')throw Error('Unexpected checkout status');
 const url=new URL(checkout.hosted_checkout_url);
 if(url.protocol!=='https:'||url.hostname!=='checkout.sumup.com'||url.username||url.password)
   throw Error('Untrusted SumUp hosted checkout URL');
 return {checkoutId:checkout.id,reference:checkout.checkout_reference,
   amountPence:Math.round(request.amount*100),currency:'GBP',status:checkout.status,
   hostedCheckoutUrl:url.toString()};
}
export function createSumUpClient({apiKey,merchantCode,fetchImpl=globalThis.fetch,enabled=false}={}){
 if(!enabled)throw Error('SumUp integration disabled');
 if(typeof apiKey!=='string'||!apiKey.startsWith('sup_sk_test_'))
   throw Error('Sandbox API key required');
 if(typeof fetchImpl!=='function')throw Error('Fetch client missing');
 const call=async(path,options={})=>{
  const response=await fetchImpl(BASE+path,{...options,headers:{
   Authorization:'Bearer '+apiKey,Accept:'application/json',
   ...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.ok)throw Error('SumUp API request failed: '+response.status);
  return response.json();
 };
 return {
  async createCheckout(input){
   const request=buildCheckoutRequest({...input,merchantCode});
   const response=await call(CHECKOUT,{method:'POST',body:JSON.stringify(request)});
   return validateCheckoutResponse(response,request);
  },
  async retrieveCheckout(checkoutId){
   if(typeof checkoutId!=='string'||!/^[A-Za-z0-9-]{8,100}$/.test(checkoutId))
    throw Error('Invalid checkout ID');
   return call(CHECKOUT+'/'+encodeURIComponent(checkoutId));
  }
 };
}
