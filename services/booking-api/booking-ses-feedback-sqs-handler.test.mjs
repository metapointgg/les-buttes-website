import test from 'node:test';
import assert from 'node:assert/strict';
import {createSesFeedbackSqsHandler,validateSesFeedbackWorkerEnvironment} from './booking-ses-feedback-sqs-handler.mjs';
const queue='arn:aws:sqs:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const topic='arn:aws:sns:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const env={BOOKING_ENVIRONMENT:'staging',AWS_REGION:'us-east-1',
 BOOKING_SES_FEEDBACK_ENABLED:'true',BOOKING_SES_FEEDBACK_QUEUE_ARN:queue,
 BOOKING_SES_FEEDBACK_TOPIC_ARN:topic,
 BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',
 BOOKING_TABLE_REGION:'eu-west-2'};
const record=(id='message-123',body=JSON.stringify({Type:'Notification',Message:'{}'}))=>({
 eventSource:'aws:sqs',eventSourceARN:queue,messageId:id,body
});
const fixture=({environment=env,reconcile=async()=>({status:'UPDATED'}),
 verify=async()=>true}={})=>{
 const calls=[],clients=[],verifiedTopics=[];
 const handler=createSesFeedbackSqsHandler({
  env:environment,dbFactory:()=>{const db={send:async()=>{},destroy:()=>{clients.push('closed');}};clients.push('created');return db;},
  verifierFactory:arn=>{verifiedTopics.push(arn);return verify;},
  reconcile:async args=>{calls.push(args);return await reconcile(args);}
 });
 return {handler,calls,clients,verifiedTopics};
};
test('LB-09 SQS worker is disabled by default and requires exact source and DynamoDB region',()=>{
 assert.throws(()=>validateSesFeedbackWorkerEnvironment({}));
 assert.equal(validateSesFeedbackWorkerEnvironment(env).topicArn,topic);
 for(const [field,value] of Object.entries({BOOKING_ENVIRONMENT:'production',
  AWS_REGION:'eu-west-2',BOOKING_SES_FEEDBACK_ENABLED:'false',
  BOOKING_SES_FEEDBACK_QUEUE_ARN:'arn:aws:sqs:us-east-1:145608514666:other',
  BOOKING_SES_FEEDBACK_TOPIC_ARN:'arn:aws:sns:us-east-1:145608514666:other',
  BOOKING_TABLE_REGION:'us-east-1',BOOKINGS_TABLE:'les-buttes-booking-production-BookingTable-X'}))
  assert.throws(()=>validateSesFeedbackWorkerEnvironment({...env,[field]:value}),undefined,field);
});
test('LB-09 verifies SNS envelope and reconciles each SQS record in sequence',async()=>{
 const x=fixture();
 const outcome=await x.handler({Records:[record('message-123'),record('message-456')]});
 assert.deepEqual(outcome,{batchItemFailures:[]});
 assert.equal(x.calls.length,2);
 assert.deepEqual(x.verifiedTopics,[topic]);
 assert.equal(x.calls[0].notification.Type,'Notification');
 assert.equal(x.calls[0].table,env.BOOKINGS_TABLE);
 assert.deepEqual(x.clients,['created','closed']);
});
test('LB-09 partial batch failure prevents acknowledging bad SNS and retains successful records',async()=>{
 const x=fixture({reconcile:async({notification})=>{
  if(notification.Message==='bad')throw Error('Unauthorised SNS');
 }});
 const bad=record('message-456',JSON.stringify({Type:'Notification',Message:'bad'}));
 const outcome=await x.handler({Records:[record('message-123'),bad,record('message-789')]});
 assert.deepEqual(outcome,{batchItemFailures:[{itemIdentifier:'message-456'}]});
 assert.equal(x.calls.length,3);
 assert.deepEqual(x.clients,['created','closed']);
});
test('LB-09 never constructs a database client for disabled, wrong-source or malformed batches',async()=>{
 const x=fixture();
 for(const event of [{Records:[]},
  {Records:[{...record(),eventSourceARN:'arn:aws:sqs:us-east-1:145608514666:bad'}]},
  {Records:[{...record(),eventSource:'aws:sns'}]},
  {Records:[{...record(),body:'x'.repeat(262145)}]}])
  await assert.rejects(x.handler(event),/Invalid staging SES feedback queue event/);
 assert.deepEqual(x.clients,[]);
 assert.equal(x.calls.length,0);
});
test('LB-09 malformed SNS JSON fails single message while other records remain eligible',async()=>{
 const x=fixture();
 const outcome=await x.handler({Records:[record('message-123','not json'),record('message-456')]});
 assert.deepEqual(outcome,{batchItemFailures:[{itemIdentifier:'message-123'}]});
 assert.equal(x.calls.length,1);
});
test('LB-09 missing verifier is fatal rather than treating raw SNS data as authenticated',async()=>{
 const x=fixture({verify:undefined});
 // The test fixture's default verifier must be overridden with a nonfunction directly.
 const handler=createSesFeedbackSqsHandler({env,
  verifierFactory:()=>null,dbFactory:()=>{throw Error('must not instantiate');}});
 await assert.rejects(handler({Records:[record()]}),/SNS verifier required/);
});

const prodTable='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const dualEnv={...env,BOOKING_PRODUCTION_SES_FEEDBACK_ENABLED:'true',
 BOOKING_PRODUCTION_FEEDBACK_TABLE:prodTable};
const productionEvent=()=>JSON.stringify({
 Type:'Notification',Message:JSON.stringify({
  eventType:'Delivery',mail:{messageId:'ses-provider-id',
   destination:['verified@example.com'],
   tags:{bookingId:['12345678-1234-1234-1234-123456789abc'],
    emailType:['confirmed'],templateId:['confirmed_v1']}}})
});
test('production SES feedback routing requires explicit exact production table',()=>{
 assert.equal(validateSesFeedbackWorkerEnvironment(dualEnv).productionTable,prodTable);
 for(const invalid of ['',env.BOOKINGS_TABLE,'other-table','les-buttes-booking-production-BookingTable-XYZ']){
  assert.throws(()=>validateSesFeedbackWorkerEnvironment({
   ...dualEnv,BOOKING_PRODUCTION_FEEDBACK_TABLE:invalid
  }),/production feedback table/);
 }
 assert.equal(validateSesFeedbackWorkerEnvironment(env).productionTable,null);
});
test('signed production delivery uses only matching outbox without affecting staging',async()=>{
 const tables=[],writes=[],checks=[];
 const handler=createSesFeedbackSqsHandler({
  env:dualEnv,
  dbFactory:()=>({send:async command=>{
   tables.push(command.input.TableName);
   return {Item:command.input.TableName===prodTable?{state:'ACCEPTED_BY_SES_NOT_DELIVERED'}:undefined};
  },destroy:()=>{}}),
  verifierFactory:()=>async()=>{checks.push('verified');return true;},
  reconcile:async args=>{writes.push(args.table);return {status:'UPDATED'};}
 });
 const result=await handler({Records:[record('prod-123',productionEvent())]});
 assert.deepEqual(result,{batchItemFailures:[]});
 assert.deepEqual(tables,[env.BOOKINGS_TABLE,prodTable]);
 assert.deepEqual(writes,[prodTable]);
 assert.ok(checks.length>=1);
});
test('dual-environment feedback fails closed if absent from both tables or present in both',async()=>{
 for(const present of [false,true]){
  let updates=0;
  const handler=createSesFeedbackSqsHandler({
   env:dualEnv,
   dbFactory:()=>({send:async()=>({Item:present?{}:undefined}),destroy:()=>{}}),
   verifierFactory:()=>async()=>true,
   reconcile:async()=>{updates++;}
  });
  assert.deepEqual(await handler({Records:[record('ambiguous-123',productionEvent())]}),
   {batchItemFailures:[{itemIdentifier:'ambiguous-123'}]});
  assert.equal(updates,0);
 }
});
test('unsigned dual-environment notification is rejected before reading either table',async()=>{
 let reads=0;
 const handler=createSesFeedbackSqsHandler({
  env:dualEnv,
  dbFactory:()=>({send:async()=>{reads++;return {Item:{}};},destroy:()=>{}}),
  verifierFactory:()=>async()=>false,
  reconcile:async()=>{throw Error('must not write');}
 });
 assert.deepEqual(await handler({Records:[record('unsigned-123',productionEvent())]}),
  {batchItemFailures:[{itemIdentifier:'unsigned-123'}]});
 assert.equal(reads,0);
});
