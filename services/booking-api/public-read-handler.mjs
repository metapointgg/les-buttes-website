// Staging-only, publicly reachable date/rate snapshots. No booking write capability.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {masterOccupied} from './master-occupied.mjs';
import {publishedPricingSnapshots} from './published-pricing-reader.mjs';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
const table=process.env.BOOKINGS_TABLE;
const origin=process.env.ALLOWED_PREVIEW_ORIGIN;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function handler(event){
 const requestOrigin=event.headers?.origin??event.headers?.Origin??'';
 const method=event.requestContext?.http?.method??event.httpMethod;
 const path=event.rawPath??event.path;
 const h={...headers,...(requestOrigin===origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})};
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??'')||
    !/^https?:\/\//.test(origin??''))return {statusCode:503,headers,body:JSON.stringify({error:'Staging preview is not configured'})};
 if(requestOrigin!==origin)return {statusCode:403,headers,body:JSON.stringify({error:'Origin not permitted'})};
 if(method!=='GET'||!['/availability','/published-pricing'].includes(path))return {statusCode:404,headers:h,body:'{"error":"Not found"}'};
 try{
  const output=path==='/availability'
    ?await masterOccupied({db:{send:input=>db.send(new QueryCommand(input.input))},table})
    :await publishedPricingSnapshots({db:{send:input=>db.send(new GetCommand(input))},table});
  return {statusCode:200,headers:h,body:JSON.stringify(output)};
 }catch{
  return {statusCode:503,headers:h,body:'{"error":"Read-only booking data temporarily unavailable"}'};
 }
}
