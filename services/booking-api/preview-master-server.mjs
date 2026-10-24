// PRIVATE LOCAL DEVELOPMENT BRIDGE — never deploy on a public listener.
// The browser only receives occupied DATE ranges; your AWS profile and booking
// metadata remain on your own computer. No booking writes are possible.
import {createServer} from 'node:http';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {masterOccupied} from './master-occupied.mjs';

const HOST='127.0.0.1',PORT=4328;
const ORIGINS=new Set(['http://localhost:4321','http://127.0.0.1:4321']);
const table=process.env.BOOKINGS_TABLE;
const environment=process.env.BOOKING_ENVIRONMENT;
if(environment!=='staging'||!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??'')){
  throw Error('Refusing to start: set BOOKING_ENVIRONMENT=staging and the existing staging master BOOKINGS_TABLE');
}
const client=new DynamoDBClient({region:'eu-west-2'});
const awsDb=DynamoDBDocumentClient.from(client);
const db={send:command=>awsDb.send(new QueryCommand(command.input))};
const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const hostname=req.headers.host;
  if(hostname!==HOST+':'+PORT||!ORIGINS.has(origin)){
    res.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end('{"error":"Local preview origin only"}');return;
  }
  const headers={
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, max-age=0',
    'Access-Control-Allow-Origin':origin,
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff'
  };
  if(req.method!=='GET'||req.url!=='/availability'){
    res.writeHead(404,headers);res.end('{"error":"Not found"}');return;
  }
  try{
    const result=await masterOccupied({db,table});
    res.writeHead(200,headers);res.end(JSON.stringify(result));
  }catch(error){
    console.error('Read-only master availability failed:',error?.name??'Error');
    res.writeHead(503,headers);res.end('{"error":"Booking master cannot be checked"}');
  }
});
server.listen(PORT,HOST,()=>{
  console.log('LOCAL-ONLY read-only booking master bridge: http://'+HOST+':'+PORT+'/availability');
  console.log('Allowed browser origins: '+[...ORIGINS].join(', '));
  console.log('Source: staging DynamoDB UNIT/DATE slots; no booking writes, guest details or AWS secrets sent to browser.');
  console.log('Stop with Ctrl+C. Leave booking requests disabled.');
});
