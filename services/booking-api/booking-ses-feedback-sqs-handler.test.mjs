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
