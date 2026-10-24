// Host-only tool. Requires AWS credentials and DynamoDB permissions. NEVER expose as a public API.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,ScanCommand,UpdateCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {validClassification,normalizeExternalReference} from './reservation-metadata.mjs';
import {agreedDirectQuote} from './direct-reservation-quote.mjs';
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
  const lifecycleStatus={APPROVED_AWAITING_PAYMENT:'AWAITING_PAYMENT',CONFIRMED:'CONFIRMED',DECLINED:'DECLINED',CANCELLED:'CANCELLED'};
  if(b.source==='direct'||(b.status==='BLOCKED'&&status==='CANCELLED')){
    extras={reservationStatus:lifecycleStatus[status]??status,...extras};
  }
  if(['REQUESTED','APPROVED_AWAITING_PAYMENT'].includes(expected)&&!isNaN(b.holdExpiresAt)&&b.holdExpiresAt<=Math.floor(Date.now()/1000))fail('Hold expired; do NOT send a payment link or confirm. Recheck calendar and contact guest first.');
  const txn=[{Update:{TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},
    UpdateExpression:'SET #status = :new, updatedAt = :at'+(nextExpiry!==undefined?', holdExpiresAt = :expiry':'')+
      Object.keys(extras).map((k,i)=>', #extra'+i+' = :extra'+i).join('')+(status==='CONFIRMED'?' REMOVE expiresAt':''),
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
  // A single transaction guarantees no partially blocked date ranges.
  // Divide longer winter tenancies into consecutive month-sized blocks.
  if(slots.length>99)fail('Too many nights for one atomic block (max 99 cottage-nights). Divide long winter lets into monthly blocks.');
  const metadata={PK:'BOOKING#'+id,SK:'META',id,unit,units,start,end,status:'BLOCKED',label:label||'Manual block',requestedAt:new Date().toISOString()};
  await db.send(new TransactWriteCommand({
    TransactItems:[
      {Put:{TableName:table,Item:metadata,ConditionExpression:'attribute_not_exists(PK)'}},
      ...slots.map(slot=>({Put:{TableName:table,Item:slot,ConditionExpression:'attribute_not_exists(PK) OR expiresAt < :now',ExpressionAttributeValues:{':now':Math.floor(Date.now()/1000)}}}))
    ],
    ClientRequestToken:id
  }));
  console.log('Blocked '+unit+' '+start+' to '+end+' under reference '+id);
}
async function classify(id,source,reservationStatus,externalRef){
  if(!id||!validClassification(source,reservationStatus))fail('Usage: classify ID airbnb CONFIRMED [EXTERNAL_REF] | classify ID direct RESERVED [EXTERNAL_REF]');
  const b=await booking(id);
  if(b.status!=='BLOCKED')fail('Cannot classify a '+b.status+' record; only existing manual reservation blocks are supported');
  const reference=normalizeExternalReference(externalRef);
  const now=new Date().toISOString();
  const exprNames={'#source':'source','#status':'status','#reservationStatus':'reservationStatus'};
  const exprValues={':source':source,':blocked':'BLOCKED',':reservationStatus':reservationStatus,':updatedAt':now,':unclassified':'unclassified'};
  let update='SET #source = :source, #reservationStatus = :reservationStatus, updatedAt = :updatedAt';
  if(source==='airbnb'){
    update+=', lastReconciledAt = :lastReconciledAt';
    exprValues[':lastReconciledAt']=now;
  }
  if(reference){
    update+=', externalReference = :externalReference';
    exprValues[':externalReference']=reference;
  }
  await db.send(new UpdateCommand({TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},
    UpdateExpression:update,
    ConditionExpression:'#status = :blocked AND (attribute_not_exists(#source) OR #source = :unclassified OR #source = :source)',
    ExpressionAttributeNames:exprNames,ExpressionAttributeValues:exprValues
  }));
  console.log('Classified '+b.unit+' '+b.start+' to '+b.end+': '+source+' / '+reservationStatus+' ('+id+'). Date slots unchanged.');
}
async function recordDirectPrice(id,pairs){
  if(!id||!pairs.length)fail('Usage: record-direct-price ID geranium=1450 honeysuckle=1650 (include exactly the cottages reserved)');
  const b=await booking(id);
  if(b.agreedDirectQuote)fail('An agreed direct price is already recorded. Do not overwrite without a separate owner reconciliation.');
  const record=agreedDirectQuote(b,pairs);
  await db.send(new UpdateCommand({
    TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},
    UpdateExpression:'SET agreedDirectQuote = :quote, updatedAt = :at',
    ConditionExpression:'#status = :blocked AND #source = :direct AND #reservationStatus = :reserved AND attribute_not_exists(agreedDirectQuote)',
    ExpressionAttributeNames:{'#status':'status','#source':'source','#reservationStatus':'reservationStatus'},
    ExpressionAttributeValues:{':quote':record,':at':new Date().toISOString(),
      ':blocked':'BLOCKED',':direct':'direct',':reserved':'RESERVED'}
  }));
  console.log('Recorded owner-agreed direct quote on existing '+b.unit+' reservation '+id);
  console.log('Agreed guest total GBP '+record.totalGBP+'; per cottage: '+record.perCottage.map(x=>x.unit+' GBP '+x.amountGBP).join(', '));
  console.log('Booking remains direct / RESERVED. No occupied dates, guest payments or booking confirmations were changed.');
}
async function main(){
  if(!table)fail('Set BOOKINGS_TABLE to the deployed DynamoDB table name');
  if(process.env.BOOKING_ENVIRONMENT==='staging' && !table.includes('staging') && !table.includes('Staging'))fail('Staging CLI refuses tables without staging in the name');
  if(command==='list'){
    let last;let count=0;
    do{
      const r=await db.send(new ScanCommand({TableName:table,FilterExpression:'begins_with(PK,:prefix)',ExpressionAttributeValues:{':prefix':'BOOKING#'},ExclusiveStartKey:last}));
      for(const b of r.Items??[]){const expired=b.holdExpiresAt && b.holdExpiresAt<Math.floor(Date.now()/1000) && ['REQUESTED','APPROVED_AWAITING_PAYMENT'].includes(b.status);console.log([b.id,expired?'HOLD_EXPIRED ('+b.status+')':b.status,b.unit,b.start,b.end,b.source??'unclassified',b.reservationStatus??'UNVERIFIED',b.guestName??''].join('\t'));count++;}
      last=r.LastEvaluatedKey;
    }while(last);
    console.log(count+' records');
  }else if(command==='show'){
    const b=await booking(args[0]);console.log(JSON.stringify({...b,holdActive:['REQUESTED','APPROVED_AWAITING_PAYMENT'].includes(b.status)&&!!(b.holdExpiresAt&&b.holdExpiresAt>Math.floor(Date.now()/1000))},null,2));
  }else if(command==='approve'){
    const [id,amount,link,...reasonParts]=args;
    if(!id||!amount||!Number.isFinite(Number(amount))||Number(amount)<=0||!link)fail('Usage: approve ID AMOUNT_GBP SUMUP_PAYMENT_URL');
    const u=new URL(link);
    const staging=process.env.BOOKING_ENVIRONMENT==='staging';
    const approvedHost=staging ? 'test.invalid' : 'pay.sumup.com';
    if(u.protocol!=='https:'||u.hostname!==approvedHost||u.username||u.password)fail('Expected '+approvedHost+' HTTPS link');
    const bookingRecord=await booking(id);
    const expectedAmount=Number(bookingRecord.quote?.totalGBP);
    const priceChanged=Math.abs(expectedAmount-Number(amount))>0.0001;
    const priceReason=reasonParts.join(' ').trim();
    if(!Number.isFinite(expectedAmount))fail('Quote missing; review and repair pricing before approval');
    if(priceChanged&&priceReason.length<5)fail('Approved amount differs from quoted GBP '+bookingRecord.quote.totalGBP+'. Add an explicit reason after the SumUp URL.');
    const expiry=Math.floor(Date.now()/1000)+48*3600;
    await change(id,'REQUESTED','APPROVED_AWAITING_PAYMENT',{approvedAmountGBP:Number(amount),paymentUrl:link,...(priceChanged?{priceChangeReason:priceReason}:{})},expiry);
    console.log('Approved. Date hold extended for 48h. Confirm guest identity and SumUp amount against the approved amount.');
    console.log('Guest email: '+bookingRecord.guestEmail);
    console.log('Subject: Your Les Buttes booking request – payment details');
    console.log('Thank you for your request for '+bookingRecord.unit+' ('+bookingRecord.start+' to '+bookingRecord.end+'). We have approved your request.');
    console.log('Total accommodation price: GBP '+Number(amount).toFixed(2)+'.');
    console.log('Please review the agreed cancellation and refund terms attached to this message BEFORE paying.');
    console.log('Your secure SumUp payment link is: '+link);
    console.log('Please complete payment within 48 hours. Your booking is confirmed only after we have verified the payment.');
    console.log('NOTE: Send the terms AND payment link manually; no guest message was dispatched.');
  }else if(command==='confirm'){
    const [id,paymentReference]=args;
    if(!paymentReference||paymentReference.length<6)fail('Usage: confirm ID VERIFIED_SUMUP_PAYMENT_REFERENCE');
    if(process.env.BOOKING_ENVIRONMENT==='staging' && !paymentReference.startsWith('TEST-'))fail('Staging confirmations must use TEST- payment references');
    if(process.env.BOOKING_ENVIRONMENT!=='staging' && paymentReference.startsWith('TEST-'))fail('Synthetic payment references cannot confirm live bookings');
    await change(id,'APPROVED_AWAITING_PAYMENT','CONFIRMED',{paymentReference,confirmedAt:new Date().toISOString()});
    console.log('Confirmed; the calendar now blocks these nights permanently. Send confirmation email.');
  }else if(command==='decline'){
    if(!args[0])fail('Usage: decline ID');
    await change(args[0],'REQUESTED','DECLINED');
    console.log('Declined; date hold released. Inform guest.');
  }else if(command==='record-direct-price'){
    const [id,...pairs]=args;
    await recordDirectPrice(id,pairs);
  }else if(command==='classify'){
    const [id,source,reservationStatus,externalRef]=args;
    await classify(id,source,reservationStatus,externalRef);
  }else if(command==='unblock'){
    if(!args[0])fail('Usage: unblock ID');
    await change(args[0],'BLOCKED','CANCELLED',{cancelReason:'Manual block removed',expiresAt:Math.floor(Date.now()/1000)+90*86400});
    console.log('Block removed; associated nights are available again.');
  }else if(command==='cancel'){
    const [id,...notes]=args;
    const reason=notes.join(' ').trim();
    if(!id||reason.length<5)fail('Usage: cancel ID "Reason / refund reconciliation reference"');
    await change(id,'CONFIRMED','CANCELLED',{cancelReason:reason,cancelledAt:new Date().toISOString(),expiresAt:Math.floor(Date.now()/1000)+90*86400});
    console.log('Booking cancelled and dates released. Any SumUp refund and guest notification must be handled separately.');
  }else if(command==='block'){
    const [unit,start,end,...label]=args;
    await putBlock(unit,start,end,label.join(' '));
  }else fail('Commands: list | show ID | approve ID GBP SUMUP_URL | confirm ID PAYMENT_REFERENCE | decline ID | cancel ID REASON | block COTTAGE START END LABEL | classify ID SOURCE RESERVATION_STATUS [EXTERNAL_REF] | record-direct-price ID geranium=GBP honeysuckle=GBP | unblock ID');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
