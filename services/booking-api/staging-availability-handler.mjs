// Private staging-only, GET-only Lambda handler. No public route or IAM is created here.
// Authentication must be enforced upstream before any deployment.
import {masterOccupied} from './master-occupied.mjs';

const headers={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, max-age=0',
  'X-Content-Type-Options':'nosniff'
};
const respond=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
const validTable=(name)=>/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(name??'');

export function createStagingAvailabilityHandler({db,table,environment,authorised=()=>false}){
  return async function handler(event={}){
    if(environment!=='staging'||!validTable(table))return respond(503,{error:'Staging unavailable'});
    // An API Gateway authorizer must set this flag only after validating a reviewer.
    // Never trust a caller-supplied HTTP header, query parameter, or body field.
    if(!authorised(event))return respond(403,{error:'Forbidden'});
    if((event.requestContext?.http?.method??event.httpMethod)!=='GET'||
      (event.rawPath??event.path)!=='/api/staging/availability')
      return respond(404,{error:'Not found'});
    try{
      return respond(200,await masterOccupied({db,table}));
    }catch(error){
      console.error('Staging availability read failed:',error?.name??'Error');
      return respond(503,{error:'Availability unavailable'});
    }
  };
}

// AWS SDK is loaded only when Lambda executes, so unit tests can inject a fake DB
// without requiring deployment-only dependencies in the website build.
export async function handler(event){
  // Reject unauthorised requests before initialising an AWS client or reading the master.
  const authorised=event?.requestContext?.authorizer?.lambda?.bookingStagingReviewer===true;
  const method=event?.requestContext?.http?.method??event?.httpMethod;
  const path=event?.rawPath??event?.path;
  if(!authorised)return respond(403,{error:'Forbidden'});
  if(method!=='GET'||path!=='/api/staging/availability')return respond(404,{error:'Not found'});
  if(process.env.BOOKING_ENVIRONMENT!=='staging'||!validTable(process.env.BOOKINGS_TABLE))
    return respond(503,{error:'Staging unavailable'});
  try{
    const [{DynamoDBClient},{DynamoDBDocumentClient,QueryCommand}]=await Promise.all([
      import('@aws-sdk/client-dynamodb'),import('@aws-sdk/lib-dynamodb')
    ]);
    const documentDb=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
    const db={send:command=>documentDb.send(new QueryCommand(command.input))};
    return createStagingAvailabilityHandler({
      db,table:process.env.BOOKINGS_TABLE,environment:process.env.BOOKING_ENVIRONMENT,
      authorised:e=>e.requestContext?.authorizer?.lambda?.bookingStagingReviewer===true
    })(event);
  }catch(error){
    console.error('Staging availability initialisation failed:',error?.name??'Error');
    return respond(503,{error:'Availability unavailable'});
  }
}
