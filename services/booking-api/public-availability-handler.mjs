// Public GET-only calendar endpoint. Returns occupied date ranges, never guest data.
// Deploy separately with read-only DynamoDB permissions and a public API route.
import {masterOccupied} from './master-occupied.mjs';

const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'};
const respond=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
const validTable=(name)=>/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(name??'');

export function createPublicAvailabilityHandler({db,table,environment}){
  return async function handler(event={}){
    if(environment!=='staging'||!validTable(table))return respond(503,{error:'Unavailable'});
    if((event.requestContext?.http?.method??event.httpMethod)!=='GET'||
       (event.rawPath??event.path)!=='/api/public/availability')return respond(404,{error:'Not found'});
    try{return respond(200,await masterOccupied({db,table}));}
    catch(error){console.error('Public calendar read failed:',error?.name??'Error');return respond(503,{error:'Unavailable'});}
  };
}

export async function handler(event={}){
  if((event.requestContext?.http?.method??event.httpMethod)!=='GET'||
     (event.rawPath??event.path)!=='/api/public/availability')return respond(404,{error:'Not found'});
  if(process.env.BOOKING_ENVIRONMENT!=='staging'||!validTable(process.env.BOOKINGS_TABLE))
    return respond(503,{error:'Unavailable'});
  try{
    const [{DynamoDBClient},{DynamoDBDocumentClient,QueryCommand}]=await Promise.all([
      import('@aws-sdk/client-dynamodb'),import('@aws-sdk/lib-dynamodb')
    ]);
    const documentDb=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
    const db={send:command=>documentDb.send(new QueryCommand(command.input))};
    return createPublicAvailabilityHandler({
      db,table:process.env.BOOKINGS_TABLE,environment:process.env.BOOKING_ENVIRONMENT
    })(event);
  }catch(error){console.error('Public calendar setup failed:',error?.name??'Error');return respond(503,{error:'Unavailable'});}
}
