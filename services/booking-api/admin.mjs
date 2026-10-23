// Host-only tool. Requires AWS credentials and DynamoDB permissions. NEVER expose as a public API.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const table=process.env.BOOKINGS_TABLE;
const DAY=86400000;
const [command,...args]=process.argv.slice(2);
function fail(message){throw Error(message);}
function dates(start,end,limit=365){
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  if(!valid(start)||!valid(end))fail('Invalid date, expected YYYY-MM-DD');
  const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z');
  const n=(b-a)/DAY;
  if(!Number.isInteger(n)||n<1||n>limit)fail('Invalid date range');
  return Array.from({length:n},(_,i)=>new Date(a+i*DAY).toISOString().slice(0,10));
}
const slotKeys=(booking)=>booking.units.flatMap(u=>dates(booking.start,booking.end).map(d=>({PK:'UNIT#'+u,SK:'DATE#'+d})));
async function booking(id){
  const b=(await db.send(new GetCommand({TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},ConsistentRead:true}))).Item;
  if(!b)fail('Booking not found');
  return b;
}
async function change(id,expected,status,extras={},nextExpiry){
  const b=await booking(id);
  if(b.status!==expected)fail('Expected '+expected+', found '+b.status);
  if(nextExpiry!==undefined&&b.holdExpiresAt<=Math.floor(Date.now()/1000))fail('Hold expired; recheck availability and request again');
  const txn=[{Update:{TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},
    UpdateExpression:'SET #status = :new, updatedAt = :at'+(nextExpiry!==undefined?', holdExpiresAt = :expiry':'')+
      Object.keys(extras).map((k,i)=>', #extra'+i+' = :extra'+i).join('')+(status==='CONFIRMED'?' REMOVE recordTtl':''),
    ConditionExpression:'#status = :old',
    ExpressionAttributeNames:{'#status':'status',...Object.fromEntries(Object.keys(extras).map((k,i)=>['#extra'+i,k]))},
    ExpressionAttributeValues:{':new':status,':old':expected,':at':new Date().toISOString(),...(nextExpiry!==undefined?{':expiry':nextExpiry}:{}),...Object.fromEntries(Object.values(extras).map((v,i)=>[':extra'+i,v]))}
  }}];
  const isRelease=['DECLINED','CANCELLED'].includes(status);
  for(const key of slotKeys(b)){
    if(isRelease)txn.push({Delete:{TableName:table,Key:key,ConditionExpression:'id = :id',ExpressionAttributeValues:{':id':id}}});
    else {
      const expiryStatus=status==='CONFIRMED'?'REMOVE expiresAt':'SET expiresAt = :expiry';
      txn.push({Update:{TableName:table,Key:key,
        UpdateExpression:expiryStatus,ConditionExpression:'id = :id'+(status==='CONFIRMED'?' AND expiresAt > :now':' AND expiresAt > :now'),
        ExpressionAttributeValues:{':id':id,':now':Math.floor(Date.now()/1000),...(status==='CONFIRMED'?{}:{':expiry':nextExpiry})}
      }});
    }
  }
  await db.send(new TransactWriteCommand({TransactItems:txn,ClientRequestToken:randomUUID()}));
}
async function putBlock(unit,start,end,label){
  const units=unit==='both'?['geranium','honeysuckle']:[unit];
  if(units.some(u=>!['geranium','honeysuckle'].includes(u)))fail('Invalid cottage');
  const nightList=dates(start,end);
  const id=randomUUID();
  const slots=units.flatMap(u=>nightList.map(d=>({PK:'UNIT#'+u,SK:'DATE#'+d,id})));
  // Short, atomic chunks; longer winter-tenancy blocks are reconciled manually if interrupted.
  for(let i=0;i<slots.length;i+=90){
    const chunk=slots.slice(i,i+90);
    await db.send(new TransactWriteCommand({TransactItems:chunk.map(slot=>({Put:{TableName:table,Item:slot,ConditionExpression:'attribute_not_exists(PK) OR expiresAt < :now',ExpressionAttributeValues:{':now':Math.floor(Date.now()/1000)}}})),ClientRequestToken:randomUUID()}));
  }
  await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:{PK:'BOOKING#'+id,SK:'META',id,unit,units,start,end,status:'BLOCKED',label:label||'Manual block',requestedAt:new Date().toISOString()},ConditionExpression:'attribute_not_exists(PK)'}}]}));
  console.log('Blocked '+unit+' '+start+' to '+end+' under reference '+id);
}
async function main(){
  if(!table)fail('Set BOOKINGS_TABLE to the deployed DynamoDB table name');
  if(command==='list'){
    let last;let count=0;
    do{
      const r=await db.send(new ScanCommand({TableName:table,FilterExpression:'begins_with(PK,:prefix)',ExpressionAttributeValues:{':prefix':'BOOKING#'},ExclusiveStartKey:last}));
      for(const b of r.Items??[]){console.log([b.id,b.status,b.unit,b.start,b.end,b.guestName??''].join('\t'));count++;}
      last=r.LastEvaluatedKey;
    }while(last);
    console.log(count+' records');
  }else if(command==='show'){
    const b=await booking(args[0]);console.log(JSON.stringify(b,null,2));
  }else if(command==='approve'){
    const [id,amount,link]=args;
    if(!id||!amount||!Number.isFinite(Number(amount))||Number(amount)<=0||!link)fail('Usage: approve ID AMOUNT_GBP SUMUP_PAYMENT_URL');
    const u=new URL(link);if(u.protocol!=='https:'||!u.hostname.endsWith('.sumup.com'))fail('Expected HTTPS SumUp payment URL');
    const expiry=Math.floor(Date.now()/1000)+48*3600;
    await change(id,'REQUESTED','APPROVED_AWAITING_PAYMENT',{approvedAmountGBP:Number(amount),paymentUrl:link},expiry);
    console.log('Approved. Date hold extended for 48h. Send the reviewed terms and SumUp link to the guest; NOT automatically emailed.');
  }else if(command==='confirm'){
    const [id,paymentReference]=args;
    if(!paymentReference||paymentReference.length<6)fail('Usage: confirm ID VERIFIED_SUMUP_PAYMENT_REFERENCE');
    await change(id,'APPROVED_AWAITING_PAYMENT','CONFIRMED',{paymentReference,confirmedAt:new Date().toISOString()});
    console.log('Confirmed; the calendar now blocks these nights permanently. Send confirmation email.');
  }else if(command==='decline'){
    if(!args[0])fail('Usage: decline ID');
    await change(args[0],'REQUESTED','DECLINED');
    console.log('Declined; date hold released. Inform guest.');
  }else if(command==='block'){
    const [unit,start,end,...label]=args;
    await putBlock(unit,start,end,label.join(' '));
  }else fail('Commands: list | show ID | approve ID GBP SUMUP_URL | confirm ID PAYMENT_REFERENCE | decline ID | block COTTAGE START END LABEL');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
