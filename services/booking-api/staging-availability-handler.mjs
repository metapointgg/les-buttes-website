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

// API Gateway must validate the Cognito JWT before populating requestContext.authorizer.jwt.
// Any authenticated user from the configured Cognito app client may read staging availability.
export function isAuthenticatedManagementUser(event){
  const claims=event?.requestContext?.authorizer?.jwt?.claims;
  if(!claims||typeof claims!=='object')return false;
  return typeof claims.sub==='string' && claims.sub.length>0;
}

export function createStagingAvailabilityHandler({db,table,environment,authorised=isAuthenticatedManagementUser}){
  return async function handler(event={}){
    if(environment!=='staging'||!validTable(table))return respond(503,{error:'Staging unavailable'});
    // An API Gateway authorizer must set this flag only after validating the Cognito JWT.
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
  const authorised=isAuthenticatedManagementUser(event);
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
      authorised:isAuthenticatedManagementUser
    })(event);
  }catch(error){
    console.error('Staging availability initialisation failed:',error?.name??'Error');
    return respond(503,{error:'Availability unavailable'});
  }
}
