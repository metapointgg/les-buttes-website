// A09: synthetic owner decisions against the dedicated isolated staging table only.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {executeOwnerTransition} from './booking-admin-transaction-writer.mjs';

const TABLE='les-buttes-lb08-staging-isolated-acceptance';
const DATES=['2099-08-28','2099-08-29','2099-08-30','2099-08-31','2099-09-01','2099-09-02','2099-09-03'];
const identity={role:'owner',subject:'A09_ISOLATED_SYNTHETIC_OWNER'};
const key=id=>({PK:'BOOKING#'+id,SK:'META'});
const slots=DATES.map(date=>({PK:'UNIT#geranium',SK:'DATE#'+date}));
export async function runA09IsolatedAcceptance({env=process.env}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.BOOKINGS_TABLE!==TABLE||env.LB08_ISOLATED_BOOKING_ACCEPTANCE!=='yes')
   throw Error('A09 requires explicit isolated staging authorisation');
 const base=new DynamoDBClient({region:'eu-west-2'});
 const db=DynamoDBDocumentClient.from(base);
 const now=Math.floor(Date.now()/1000);
 const results=[];
 const read=async Key=>(await db.send(new GetCommand({TableName:TABLE,Key,ConsistentRead:true}))).Item;
 try{
  const described=await db.send(new DescribeTableCommand({TableName:TABLE}));
  if(described.Table?.TableArn!=='arn:aws:dynamodb:eu-west-2:145608514666:table/'+TABLE||
     described.Table?.TableStatus!=='ACTIVE')throw Error('Wrong isolated acceptance table');
  for(const action of ['approve','decline','cancel']){
   const id=randomUUID(),bookingKey=key(id);
   const booking={...bookingKey,id,source:'direct',GSI1PK:'BOOKING_REQUESTS',
     status:action==='cancel'?'CONFIRMED':'REQUESTED',
     reservationStatus:action==='cancel'?'CONFIRMED':'PENDING_REVIEW',units:['geranium'],
     start:'2099-08-28',end:'2099-09-04',holdExpiresAt:now+3600,
     quote:{totalGBP:1085},kind:'A09_ISOLATED_ACCEPTANCE'};
   let seeded=false;
   try{
    await db.send(new TransactWriteCommand({TransactItems:[
     booking,...slots.map(k=>({...k,id,expiresAt:now+3600,kind:'A09_ISOLATED_ACCEPTANCE'}))
    ].map(Item=>({Put:{TableName:TABLE,Item,ConditionExpression:'attribute_not_exists(PK)'}}))}));
    seeded=true;
    const result=await executeOwnerTransition({db,table:TABLE,
     readBooking:async requested=>requested===id?read(bookingKey):null,
     identity,bookingId:id,action,nowEpoch:now,
     ...(action==='approve'?{approval:{usePublishedQuote:true}}:{}),
     ...(action==='cancel'?{reason:'A09 isolated synthetic cancellation acceptance'}:{})});
    const updated=await read(bookingKey);
    const occupied=await Promise.all(slots.map(read));
    const audits=(await db.send(new QueryCommand({TableName:TABLE,
     KeyConditionExpression:'PK = :pk AND begins_with(SK, :prefix)',
     ExpressionAttributeValues:{':pk':bookingKey.PK,':prefix':'AUDIT#'},
     ConsistentRead:true}))).Items??[];
    if(result.affectedNights!==7||updated?.status!==(action==='approve'?'APPROVED_AWAITING_PAYMENT':action==='cancel'?'CANCELLED':'DECLINED')||
       updated?.reservationStatus!==(action==='approve'?'AWAITING_PAYMENT':action==='cancel'?'CANCELLED':'DECLINED')||
       audits.length!==1||audits[0].action!==action||audits[0].actor!==identity.subject)
      throw Error('A09 metadata/audit readback failed: '+action);
    if(action==='approve'&&(updated.approvedAmountGBP!==1085||
       occupied.some(x=>x?.id!==id||x.expiresAt!==now+48*3600)))
      throw Error('A09 approval hold extension failed');
    if((action==='decline'||action==='cancel')&&occupied.some(Boolean))
      throw Error('A09 owner transition did not release all slots: '+action);
    if(action==='cancel'&&(!updated.cancelReason||!updated.cancelledAt))
      throw Error('A09 cancellation reason/timestamp not recorded');
    results.push({action,sevenNightsVerified:true,auditVerified:true});
   }finally{
    if(seeded){
     const audits=(await db.send(new QueryCommand({TableName:TABLE,
      KeyConditionExpression:'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues:{':pk':bookingKey.PK,':prefix':'AUDIT#'},ConsistentRead:true}))).Items??[];
     const candidates=[{Key:bookingKey,field:'id'},...slots.map(Key=>({Key,field:'id'})),
      ...audits.map(x=>({Key:{PK:x.PK,SK:x.SK},field:'bookingId'}))];
     const existing=(await Promise.all(candidates.map(async c=>({...c,item:await read(c.Key)})))).filter(c=>c.item);
     if(existing.some(c=>c.item[c.field]!==id))throw Error('A09 cleanup ownership mismatch');
     if(existing.length)await db.send(new TransactWriteCommand({TransactItems:existing.map(c=>({
      Delete:{TableName:TABLE,Key:c.Key,ConditionExpression:'#owner = :id',
       ExpressionAttributeNames:{'#owner':c.field},ExpressionAttributeValues:{':id':id}}
     }))}));
     if((await Promise.all(candidates.map(c=>read(c.Key)))).some(Boolean))
       throw Error('A09 cleanup verification failed');
    }
   }
  }
  return {isolatedOwnerTransitionsPassed:true,results,syntheticRecordsCleanedUp:true};
 }finally{db.destroy?.();base.destroy?.();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{console.log(JSON.stringify(await runA09IsolatedAcceptance(),null,2));}
 catch(error){console.error('A09 isolated acceptance failed:',error);process.exitCode=1;}
}
