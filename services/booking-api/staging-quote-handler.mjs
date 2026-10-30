// Isolated read-only staging quote route. No guest data or writes.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {quotePublishedBands} from './published-band-quote.mjs';
const UNITS=['geranium','honeysuckle'];
const DAY=86400000;
export function validateQuoteQuery(q){
 const units=q?.unit==='both'?[...UNITS]:[q?.unit];
 if(units.some(u=>!UNITS.includes(u)))throw Error('Invalid cottage');
 const guests=Number(q?.guests);
 if(!/^\d+$/.test(String(q?.guests))||!Number.isInteger(guests)||guests<1||
    guests>(units.length===2?10:units[0]==='geranium'?4:6))throw Error('Invalid guest count');
 return {units,start:q.start,end:q.end,guests};
}
export async function stagingQuote(q,{db,table}){
 if(!db||!table)throw Error('Booking master unavailable');
 const {units,start,end,guests}=validateQuoteQuery(q);
 const results=[];
 for(const unit of units){
  const pricing=(await db.send(new GetCommand({TableName:table,
   Key:{PK:'CONFIG#pricing#'+unit,SK:'CURRENT'},ConsistentRead:true}))).Item?.value;
  const price=quotePublishedBands(unit,start,end,pricing);
  // The master is authoritative. Query all occupied-night slots for the stay.
  let cursor;
  do{
   const response=await db.send(new QueryCommand({TableName:table,ConsistentRead:true,
    KeyConditionExpression:'PK = :pk AND SK BETWEEN :from AND :to',
    ExpressionAttributeValues:{':pk':'UNIT#'+unit,':from':'DATE#'+start,':to':'DATE#'+new Date(Date.parse(end+'T00:00:00Z')-DAY).toISOString().slice(0,10)},
    ProjectionExpression:'PK, SK, expiresAt',ExclusiveStartKey:cursor}));
   if((response.Items??[]).some(row=>row.expiresAt===undefined||Number(row.expiresAt)>Math.floor(Date.now()/1000)))
    throw Error('Requested dates unavailable');
   cursor=response.LastEvaluatedKey;
  }while(cursor);
  results.push(price);
 }
 const pence=results.reduce((sum,r)=>sum+Math.round(Number(r.totalGBP)*100),0);
 return {currency:'GBP',units,guests,start,end,breakdown:results,
  totalGBP:(pence/100).toFixed(2),bookingConfirmed:false};
}
export async function handler(event){
 const origin=event?.headers?.origin??event?.headers?.Origin;
 const allowed=process.env.ALLOWED_PREVIEW_ORIGIN;
 const headers={'content-type':'application/json','access-control-allow-origin':allowed??''};
 const respond=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||!process.env.BOOKINGS_TABLE||!allowed||
    origin!==allowed)return respond(403,{error:'Forbidden'});
 if((event?.requestContext?.http?.method??event?.httpMethod)!=='GET'||
    (event?.rawPath??event?.path)!=='/quote')return respond(404,{error:'Not found'});
 try{
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return respond(200,await stagingQuote(event.queryStringParameters,{
   db,table:process.env.BOOKINGS_TABLE}));
 }catch(error){
  if(/^(Invalid quote selection|Invalid cottage|Invalid guest count|Invalid stay length|Invalid published|Saturday arrival|Stay exceeds|Quote outside|Below published|Missing or ambiguous published nightly rate|Requested dates unavailable)/.test(error.message))
   return respond(422,{error:'Dates or selection cannot be quoted'});
  console.error('staging quote failed',error);
  return respond(503,{error:'Read-only booking data temporarily unavailable'});
 }
}
