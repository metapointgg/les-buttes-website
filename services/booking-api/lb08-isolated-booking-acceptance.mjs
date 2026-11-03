// LB-08 isolated acceptance: exercises the real reconciler against a disposable table.
// Never use the real staging booking table. The provider checkout is a synthetic
// paid-evidence fixture; no network call to SumUp and no guest booking is involved.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {reconcileVerifiedPayment} from './sumup-payment-reconciler.mjs';

export const ISOLATED_TABLE='les-buttes-lb08-staging-isolated-acceptance';
const ACCOUNT='145608514666';
const NIGHTS=['2099-08-28','2099-08-29','2099-08-30','2099-08-31',
 '2099-09-01','2099-09-02','2099-09-03'];
const txKey=(id)=>({PK:'PAYMENT_TRANSACTION#'+id,SK:'CONFIRMATION'});
const bookKey=(id)=>({PK:'BOOKING#'+id,SK:'META'});

export async function runIsolatedBookingAcceptance({env=process.env,clientFactory,uuid=randomUUID}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.BOOKINGS_TABLE!==ISOLATED_TABLE||env.LB08_ISOLATED_BOOKING_ACCEPTANCE!=='yes')
  throw Error('LB-08 isolated table and explicit operator authorisation required');
 const base=clientFactory?null:new DynamoDBClient({region:'eu-west-2'});
 const db=clientFactory?clientFactory():DynamoDBDocumentClient.from(base);
 const id=uuid(),checkoutId=uuid(),transactionId=uuid();
 const merchantCode='LB08_SYNTHETIC_MERCHANT';
 const reference='lb08_acceptance_'+id.replaceAll('-','').slice(0,24);
 if(![id,checkoutId,transactionId].every(x=>/^[a-f0-9-]{36}$/i.test(x)))
  throw Error('Invalid synthetic test identifiers');
 const bookingKey=bookKey(id),now=Math.floor(Date.now()/1000),expires=now+3600;
 const slots=NIGHTS.map(date=>({PK:'UNIT#geranium',SK:'DATE#'+date}));
 const booking={...bookingKey,id,source:'direct',GSI1PK:'BOOKING_REQUESTS',
  status:'APPROVED_AWAITING_PAYMENT',reservationStatus:'AWAITING_PAYMENT',
  units:['geranium'],start:'2099-08-28',end:'2099-09-04',
  approvedAmountGBP:1,holdExpiresAt:expires,kind:'LB08_ISOLATED_ACCEPTANCE'};
 const checkout={PK:bookingKey.PK,SK:'PAYMENT#CHECKOUT',bookingId:id,
  checkoutId,reference,amountPence:100,currency:'GBP',status:'PENDING',
  kind:'LB08_ISOLATED_ACCEPTANCE'};
 const fixture={id:checkoutId,checkout_reference:reference,merchant_code:merchantCode,
  amount:1,currency:'GBP',status:'PAID',transactions:[{
   id:transactionId,status:'SUCCESSFUL',amount:1,currency:'GBP',
   merchant_code:merchantCode}]};
 const table=ISOLATED_TABLE;
 let seeded=false,output;
 try {
  const described=await db.send(new DescribeTableCommand({TableName:table}));
  if(described.Table?.TableName!==table||described.Table?.TableStatus!=='ACTIVE'||
     described.Table?.TableArn!==`arn:aws:dynamodb:eu-west-2:${ACCOUNT}:table/${table}`)
   throw Error('Dedicated acceptance table identity not verified');
  const putItems=[booking,checkout,...slots.map(key=>({...key,id,expiresAt:expires,
   kind:'LB08_ISOLATED_ACCEPTANCE'}))];
  await db.send(new TransactWriteCommand({TransactItems:putItems.map(Item=>({
   Put:{TableName:table,Item,ConditionExpression:'attribute_not_exists(PK)'}
  }))}));
  seeded=true;
  const result=await reconcileVerifiedPayment({db,table,bookingId:id,
   merchantCode,fetchCheckout:async requested=>{
    if(requested!==checkoutId)throw Error('Unexpected synthetic checkout identity');
    return fixture;
   },nowEpoch:now});
  if(result.status!=='CONFIRMED'||result.affectedNights!==7)
   throw Error('Synthetic confirmation response mismatch');
  const read=async Key=>(await db.send(new GetCommand({TableName:table,Key,
   ConsistentRead:true}))).Item;
  const confirmed=await read(bookingKey),claimed=await read(txKey(transactionId));
  const confirmedSlots=await Promise.all(slots.map(read));
  if(confirmed?.status!=='CONFIRMED'||confirmed.reservationStatus!=='CONFIRMED'||
     confirmed.paymentTransactionId!==transactionId||
     claimed?.bookingId!==id||claimed.checkoutId!==checkoutId||
     claimed.amountPence!==100||claimed.currency!=='GBP'||
     confirmedSlots.some(s=>s?.id!==id||s.expiresAt!==undefined))
   throw Error('Atomic confirmation strong-readback mismatch');
  let replayRejected=false;
  try{
   await reconcileVerifiedPayment({db,table,bookingId:id,merchantCode,
    fetchCheckout:async()=>fixture,nowEpoch:now});
  }catch(error){replayRejected=/Booking state mismatch|not eligible/.test(error.message);}
  if(!replayRejected)throw Error('Synthetic payment replay was not rejected');
  const audits=await db.send(new QueryCommand({TableName:table,
   KeyConditionExpression:'PK = :pk AND begins_with(SK, :prefix)',
   ExpressionAttributeValues:{':pk':bookingKey.PK,':prefix':'AUDIT#'},
   ConsistentRead:true}));
  if(audits.Items?.length!==1||audits.Items[0]?.action!=='payment_confirmed')
   throw Error('Expected exactly one payment confirmation audit');
  output={confirmed:true,affectedNights:7,claimVerified:true,
   auditRecords:1,replayRejected:true,syntheticBookingId:id,
   note:'Synthetic provider fixture and isolated DynamoDB; no actual SumUp payment'};
 }finally{
  // The isolated test table is never shared with live services. Cleanup also
  // runs after failure where seeding succeeded; any failure propagates.
  try{
   if(seeded){
    const audits=await db.send(new QueryCommand({TableName:table,
     KeyConditionExpression:'PK = :pk AND begins_with(SK, :prefix)',
     ExpressionAttributeValues:{':pk':bookingKey.PK,':prefix':'AUDIT#'},
     ConsistentRead:true}));
    const cleanup=[
     {Key:bookingKey,check:'id'},
     {Key:{PK:bookingKey.PK,SK:'PAYMENT#CHECKOUT'},check:'bookingId'},
     ...slots.map(Key=>({Key,check:'id'})),
     {Key:txKey(transactionId),check:'bookingId'},
     ...(audits.Items??[]).filter(x=>x.bookingId===id)
      .map(x=>({Key:{PK:x.PK,SK:x.SK},check:'bookingId'}))
    ];
    await db.send(new TransactWriteCommand({TransactItems:cleanup.map(x=>({
     Delete:{TableName:table,Key:x.Key,
      ConditionExpression:'#owner = :id',
      ExpressionAttributeNames:{'#owner':x.check},
      ExpressionAttributeValues:{':id':id}}
    }))}));
    if(output)output.syntheticRecordsCleanedUp=true;
   }
  }finally{db.destroy?.();base?.destroy?.();}
 }
 return output;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await runIsolatedBookingAcceptance(),null,2)+'\n');}
 catch(e){process.stderr.write('LB-08 isolated acceptance failed: '+(e.name??'Error')+
  ' '+(e.message??'')+'\n');process.exitCode=1;}
}
