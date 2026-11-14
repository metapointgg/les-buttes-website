// Production read-only quotation endpoint. It can price and validate availability,
// but it cannot create a booking, hold, payment, notification or refund.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {stagingQuote} from './staging-quote-handler.mjs';
import {readProductionPaymentSettings} from './production-payment-settings.mjs';
import {calculatePaymentSchedule} from './booking-payment-policy.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const ORIGINS=new Set(['https://lesbuttes.com','https://www.lesbuttes.com']);

export function createProductionQuoteHandler({
 db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'})),env=process.env
}={}){
 return async event=>{
  const origin=event?.headers?.origin??event?.headers?.Origin??'';
  const headers={'content-type':'application/json','cache-control':'no-store',
   ...(ORIGINS.has(origin)?{'access-control-allow-origin':origin,'vary':'Origin'}:{})};
  const respond=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
  if(env.BOOKING_ENVIRONMENT!=='production'||env.PRODUCTION_QUOTE_ENABLED!=='true'||
     !TABLE.test(env.BOOKINGS_TABLE??''))return respond(503,{error:'Production quotation unavailable'});
  if((event?.requestContext?.http?.method??event?.httpMethod)!=='GET'||
     (event?.rawPath??event?.path)!=='/quote')return respond(404,{error:'Not found'});
  if(origin&&!ORIGINS.has(origin))return respond(403,{error:'Forbidden'});
  try{
   const quoted=await stagingQuote(event.queryStringParameters,{db,
    table:env.BOOKINGS_TABLE,airbnbRequired:true});
   const config=await readProductionPaymentSettings({db,table:env.BOOKINGS_TABLE});
   const payment=calculatePaymentSchedule({totalPence:Math.round(Number(quoted.totalGBP)*100),
    arrival:quoted.start,policy:config.value});
   return respond(200,{...quoted,payment:{...payment,policyVersion:config.version}});
  }catch(error){
   if(/^(Airbnb dates unavailable|Invalid quote selection|Invalid cottage|Invalid guest count|Invalid stay length|Invalid published|Saturday arrival|Stay exceeds|Quote outside|Below published|Missing or ambiguous published nightly rate|Requested dates unavailable)/.test(error.message))
    return respond(422,{error:'Dates or selection cannot be quoted'});
   console.error('PRODUCTION_QUOTE_READ_FAILED',error?.name??'Error');
   return respond(503,{error:'Production quotation temporarily unavailable'});
  }
 };
}
export const handler=createProductionQuoteHandler();
