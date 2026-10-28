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

// The exported Lambda entrypoint remains fail-closed until an authorised integration
// supplies a trusted authorizer context. It cannot be enabled by client-side settings.
const table=process.env.BOOKINGS_TABLE;
const environment=process.env.BOOKING_ENVIRONMENT;
// Defer loading AWS SDK until an authorised request actually reads the master.
// This also allows pure handler tests without installing deployment-only SDK packages.
let sdkPromise;
const loadSdk=()=>sdkPromise??=Promise.all([
  import('@aws-sdk/client-dynamodb'),import('@aws-sdk/lib-dynamodb')
]).then(([{DynamoDBClient},{DynamoDBDocumentClient,QueryCommand}])=>({
  documentDb:DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'})),QueryCommand
}));
const db={send:async command=>{
  const {documentDb,QueryCommand}=await loadSdk();
  return documentDb.send(new QueryCommand(command.input));
}};
export const handler=createStagingAvailabilityHandler({
  db,table,environment,
  authorised:event=>event.requestContext?.authorizer?.lambda?.bookingStagingReviewer===true
});
