// Production read-only availability endpoint. It fails closed unless both real
// Airbnb snapshots are fresh and verified in the isolated production master.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {masterOccupied} from './master-occupied.mjs';

const TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0',
 'X-Content-Type-Options':'nosniff'};
const response=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});

export function createProductionAvailabilityHandler({db,table,environment,airbnbRequired=true}){
 return async event=>{
  if(environment!=='production'||!TABLE.test(table??''))return response(503,{error:'Unavailable'});
  if((event?.requestContext?.http?.method??event?.httpMethod)!=='GET'||
     (event?.rawPath??event?.path)!=='/availability')return response(404,{error:'Not found'});
  try{
   return response(200,await masterOccupied({db,table,airbnbRequired,
    mode:'LIVE_PRODUCTION_MASTER_READ_ONLY'}));
  }catch(error){
   console.error('Production availability read failed:',error?.name??'Error');
   return response(503,{error:'Availability cannot be verified'});
  }
 };
}

let deployed;
export async function handler(event){
 if(!deployed){
  const documentDb=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
  const db={send:command=>documentDb.send(new QueryCommand(command.input))};
  deployed=createProductionAvailabilityHandler({db,table:process.env.BOOKINGS_TABLE,
   environment:process.env.BOOKING_ENVIRONMENT,
   airbnbRequired:process.env.BOOKING_AIRBNB_REQUIRED==='true'});
 }
 return deployed(event);
}
