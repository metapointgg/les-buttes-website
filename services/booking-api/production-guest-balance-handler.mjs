// The guest's durable email link initiates a fresh short-lived SumUp session.
// Never accepts a payment amount, payment-status assertion or provider URL.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {SSMClient} from '@aws-sdk/client-ssm';
import {createVerifiedProductionSumUpClient,productionPaymentsEnabled} from './sumup-production-runtime.mjs';
import {verifyBalancePaymentAccess} from './booking-balance-link.mjs';
import {ensureBalanceCheckout} from './production-balance-payments.mjs';

const ALLOWED=new Set(['https://lesbuttes.com','https://www.lesbuttes.com']);
const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ID=/^[0-9a-f]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function createProductionGuestBalanceHandler({db,env=process.env,
 clientFactory=createVerifiedProductionSumUpClient,
 ssmFactory=()=>new SSMClient({region:'eu-west-2'}),
 register=ensureBalanceCheckout}={}){
 return async event=>{
  const origin=event?.headers?.origin??event?.headers?.Origin??'';
  const headers={'content-type':'application/json','cache-control':'no-store',
   ...(ALLOWED.has(origin)?{'access-control-allow-origin':origin,'vary':'Origin'}:{})};
  const send=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(value)});
  if(env.BOOKING_ENVIRONMENT!=='production'||!TABLE.test(env.BOOKINGS_TABLE??'')||
     !productionPaymentsEnabled(env)||env.LIVE_BOOKINGS_APPROVED!=='true'||
     env.BOOKING_CONTROLLED_TEST_ONLY_ENABLED==='true')
   return send(503,{error:'Balance payments unavailable'});
  if((event?.requestContext?.http?.method??event?.httpMethod)!=='POST'||
     (event?.rawPath??event?.path)!=='/balance/checkout')
   return send(404,{error:'Not found'});
  if(!ALLOWED.has(origin))return send(403,{error:'Forbidden'});
  if(typeof event.body!=='string'||event.body.length>1000||event.isBase64Encoded)
   return send(400,{error:'Invalid payment request'});
  let body;
  try{body=JSON.parse(event.body);}catch{return send(400,{error:'Invalid payment request'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join(',')!=='access,bookingId'||
     !ID.test(body.bookingId??'')||!TOKEN.test(body.access??''))
   return send(400,{error:'Invalid payment request'});
  db??=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}),
   {marshallOptions:{removeUndefinedValues:true}});
  try{
   const {Item:booking}=await db.send(new GetCommand({TableName:env.BOOKINGS_TABLE,
    Key:{PK:'BOOKING#'+body.bookingId,SK:'META'},ConsistentRead:true}));
   if(!verifyBalancePaymentAccess({booking,bookingId:body.bookingId,token:body.access}))
    return send(403,{error:'This balance-payment link is no longer valid'});
   const ssm=ssmFactory();
   try{
    const sumup=await clientFactory({ssm,env});
    const result=await register({db,table:env.BOOKINGS_TABLE,
     bookingId:body.bookingId,identity:{role:'system',subject:'system:guest-balance-link'},
     sumup,env});
    const checkout=result.checkout;
    if(!['REGISTERED','ALREADY_REGISTERED'].includes(result.status)||
       checkout?.status!=='PENDING'||checkout.bookingId!==body.bookingId||
       checkout.amountPence!==booking.balanceDuePence||
       typeof checkout.hostedCheckoutUrl!=='string'||
       !/^https:\/\/checkout\.sumup\.com\/pay\/c-[0-9a-f-]{36}$/i.test(checkout.hostedCheckoutUrl))
     throw Error('Independently registered checkout required');
    return send(200,{paymentUrl:checkout.hostedCheckoutUrl,sessionMinutes:30});
   }finally{ssm.destroy?.();}
  }catch(error){
   // Never log the guest capability or the SumUp response.
   console.error('GUEST_BALANCE_CHECKOUT_REVIEW',error?.name??'Error');
   return send(503,{error:'Secure payment session unavailable; please contact us'});
  }
 };
}
