import {sandboxRefund} from './sandbox-refund.mjs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
// Dedicated entrypoint for the canonical staging payment reconciliation route.
// Defence in depth: the API Gateway JWT authorizer is still mandatory.
import {handler as adminHandler} from './booking-admin-http.mjs';
import {authorisedPaymentSchedule,reconcileScheduledPayments} from './staging-payment-schedule.mjs';

const PAYMENT_ROUTE=/^\/admin\/bookings\/[0-9a-f-]{36}\/payment\/reconcile$/i;
const deny=(statusCode,error)=>({
  statusCode,
  headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
  body:JSON.stringify({error})
});

export async function handler(event){
  if(!event?.requestContext&&event?.source==='lesbuttes.staging.refund-acceptance'&&event.account==='145608514666'&&event.region==='eu-west-2'&&event.policyId==='SYNTHETIC_FULL_REFUND_V1'){
    const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
    try{return await sandboxRefund({db,bookingId:event.bookingId});}finally{db.destroy?.();}
  }
  if(authorisedPaymentSchedule(event))return reconcileScheduledPayments(event);
  if(event?.requestContext?.http?.method!=='POST'||
     !PAYMENT_ROUTE.test(event?.rawPath??''))
    return deny(404,'Not found');
  if(event?.requestContext?.routeKey!=='POST /admin/bookings/{bookingId}/payment/reconcile')
    return deny(403,'Forbidden');
  if(!event?.requestContext?.authorizer?.jwt?.claims)
    return deny(403,'Forbidden');
  return adminHandler(event);
}
