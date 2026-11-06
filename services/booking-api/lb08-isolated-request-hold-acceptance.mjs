// A08 isolated atomic-hold acceptance. This never targets the shared booking master.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient,DescribeTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {ISOLATED_TABLE} from './lb08-isolated-booking-acceptance.mjs';

const ACCOUNT='145608514666';
const NIGHTS=['2099-07-04','2099-07-05','2099-07-06','2099-07-07','2099-07-08','2099-07-09','2099-07-10'];

export async function runIsolatedRequestHoldAcceptance({env=process.env,clientFactory,uuid=randomUUID}={}){
  if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
     env.BOOKINGS_TABLE!==ISOLATED_TABLE||env.LB08_ISOLATED_BOOKING_ACCEPTANCE!=='yes')
    throw Error('LB-08 isolated table and explicit operator authorisation required');
  const base=clientFactory?null:new DynamoDBClient({region:'eu-west-2'});
  const db=clientFactory?clientFactory():DynamoDBDocumentClient.from(base);
  const id=uuid(),collisionId=uuid(),now=Math.floor(Date.now()/1000);
  if(![id,collisionId].every(x=>/^[a-f0-9-]{36}$/i.test(x))||id===collisionId)
    throw Error('Invalid synthetic identifiers');
  const bookingKey={PK:'BOOKING#'+id,SK:'META'};
  const collisionKey={PK:'BOOKING#'+collisionId,SK:'META'};
  const slots=NIGHTS.map(day=>({PK:'UNIT#geranium',SK:'DATE#'+day}));
  const booking={...bookingKey,id,kind:'LB08_A08_SYNTHETIC',status:'REQUESTED',
    reservationStatus:'PENDING_REVIEW',units:['geranium'],start:NIGHTS[0],
    end:'2099-07-11',guestEmail:'test@example.invalid',holdExpiresAt:now+3600};
  const slotItems=slots.map(key=>({...key,id,expiresAt:now+3600,kind:'LB08_A08_SYNTHETIC'}));
  let seeded=false,output;
  const read=async Key=>(await db.send(new GetCommand({TableName:ISOLATED_TABLE,Key,ConsistentRead:true}))).Item;
  try{
    const table=await db.send(new DescribeTableCommand({TableName:ISOLATED_TABLE}));
    if(table.Table?.TableName!==ISOLATED_TABLE||table.Table?.TableStatus!=='ACTIVE'||
       table.Table?.TableArn!==`arn:aws:dynamodb:eu-west-2:${ACCOUNT}:table/${ISOLATED_TABLE}`)
      throw Error('Dedicated acceptance table identity not verified');
    await db.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:ISOLATED_TABLE,Item:booking,ConditionExpression:'attribute_not_exists(PK)'}},
      ...slotItems.map(Item=>({Put:{TableName:ISOLATED_TABLE,Item,
        ConditionExpression:'attribute_not_exists(PK)'}}))
    ]}));
    seeded=true;
    if((await read(bookingKey))?.id!==id||
       (await Promise.all(slots.map(read))).some(x=>x?.id!==id))
      throw Error('Atomic hold readback mismatch');
    let conflictRejected=false;
    try{
      await db.send(new TransactWriteCommand({TransactItems:[
        {Put:{TableName:ISOLATED_TABLE,Item:{...collisionKey,id:collisionId,
          kind:'LB08_A08_SYNTHETIC'},ConditionExpression:'attribute_not_exists(PK)'}},
        {Put:{TableName:ISOLATED_TABLE,Item:{...slots[0],id:collisionId},
          ConditionExpression:'attribute_not_exists(PK)'}}
      ]}));
    }catch(e){
      conflictRejected=e.name==='TransactionCanceledException'||
        e.name==='ConditionalCheckFailedException';
      if(!conflictRejected)throw e;
    }
    if(!conflictRejected)throw Error('Overlapping synthetic hold was not rejected');
    if(await read(collisionKey))throw Error('Failed collision wrote a booking record');
    output={atomicHoldVerified:true,conflictRejected:true,orphanBookingRejected:true,
      nights:slots.length,syntheticBookingId:id};
  }finally{
    try{
      // Clean only records owned by this invocation. Never delete another owner's slot.
      if(seeded){
        const candidates=[bookingKey,...slots];
        const existing=await Promise.all(candidates.map(async Key=>({Key,Item:await read(Key)})));
        if(existing.some(x=>x.Item&&x.Item.id!==id))
          throw Error('Unexpected ownership during isolated cleanup');
        const owned=existing.filter(x=>x.Item);
        if(owned.length)await db.send(new TransactWriteCommand({TransactItems:owned.map(x=>({
          Delete:{TableName:ISOLATED_TABLE,Key:x.Key,ConditionExpression:'#id = :id',
            ExpressionAttributeNames:{'#id':'id'},ExpressionAttributeValues:{':id':id}}
        }))}));
        if(output)output.syntheticRecordsCleanedUp=true;
      }
    }finally{db.destroy?.();base?.destroy?.();}
  }
  return output;
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{console.log(JSON.stringify(await runIsolatedRequestHoldAcceptance(),null,2));}
  catch(e){console.error('A08 isolated hold acceptance failed:',e);process.exitCode=1;}
}
