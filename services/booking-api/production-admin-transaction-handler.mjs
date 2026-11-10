import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {createReadOnlyAdminReader} from './booking-admin-reader.mjs';
import {createAdminHandler,identityFromGateway} from './booking-admin-http.mjs';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';
import {readRegisteredCheckout} from './sumup-checkout-store.mjs';
import {productionCheckoutEnabled,registerCheckoutWithLiveSumUp} from './production-booking-checkout-runtime.mjs';
import {productionReconciliationEnabled,reconcileOwnerLivePayment} from './production-payment-reconciliation-runtime.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error})});
let deployed;
const deploymentAllowed=()=>process.env.BOOKING_ENVIRONMENT==='production'&&TABLE.test(process.env.BOOKINGS_TABLE??'');
const writesEnabled=()=>deploymentAllowed()&&process.env.MANAGEMENT_WRITES_ENABLED==='true'&&process.env.LIVE_BOOKINGS_APPROVED==='true';

export async function handler(event){
 if(!deploymentAllowed())return reply(503,'Production booking management unavailable');
 const path=event?.rawPath??'';
 if(!path.startsWith('/admin/production/'))return reply(404,'Not found');
 if(!event?.requestContext?.authorizer?.jwt?.claims)return reply(403,'Forbidden');
 if(!deployed){
  const table=process.env.BOOKINGS_TABLE;
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}),{marshallOptions:{removeUndefinedValues:true}});
  const reader=createReadOnlyAdminReader({bookingIndex:'BookingRequestsIndex',authorise:async request=>identityFromGateway(request)});
  deployed=createAdminHandler({
   reader,deploymentAllowed,writeDeploymentAllowed:deploymentAllowed,writeEnabled:writesEnabled,
   approvalEnabled:()=>writesEnabled()&&process.env.MANAGEMENT_APPROVAL_ENABLED==='true',
   checkoutEnabled:()=>productionCheckoutEnabled(process.env),
   reconciliationEnabled:()=>productionReconciliationEnabled(process.env),
   registerCheckout:args=>registerCheckoutWithLiveSumUp({db,...args}),
   reconcilePayment:args=>reconcileOwnerLivePayment({db,...args}),
   readCheckout:({bookingId})=>readRegisteredCheckout({db,table,bookingId}),
   writeAction:async args=>executeOwnerTransition({...args,db,table,
    readCancellationPolicy:async version=>(await db.send(new GetCommand({TableName:table,
     Key:{PK:'CONFIG#cancellation#all',SK:'VERSION#'+version},ConsistentRead:true}))).Item??null,
    readBooking:async bookingId=>(await db.send(new GetCommand({TableName:table,
     Key:{PK:'BOOKING#'+bookingId,SK:'META'},ConsistentRead:true}))).Item??null})
  });
 }
 return deployed({...event,rawPath:path.replace('/admin/production/','/admin/')});
}
