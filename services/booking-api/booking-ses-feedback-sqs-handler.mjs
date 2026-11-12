// LB-09: Signed SES delivery feedback from the existing SQS event source.
// Staging mode remains the default. Explicit opt-in permits matching the same
// authenticated event against exactly one staging or production outbox.
// No email sends, booking state writes, payment, or availability actions.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {createSnsNotificationVerifier} from './booking-sns-signature.mjs';
import {parseSesFeedback,reconcileAuthenticatedSesFeedback} from './booking-ses-feedback.mjs';

const QUEUE_ARN='arn:aws:sqs:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const TOPIC_ARN='arn:aws:sns:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const PRODUCTION_TABLE=/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/;
const SQS_ID=/^[A-Za-z0-9_-]{3,100}$/;
export function validateSesFeedbackWorkerEnvironment(env=process.env){
 if(env.BOOKING_ENVIRONMENT!=='staging'||
    env.AWS_REGION!=='us-east-1'||
    env.BOOKING_SES_FEEDBACK_ENABLED!=='true'||
    env.BOOKING_SES_FEEDBACK_QUEUE_ARN!==QUEUE_ARN||
    env.BOOKING_SES_FEEDBACK_TOPIC_ARN!==TOPIC_ARN||
    !TABLE.test(env.BOOKINGS_TABLE??'')||
    env.BOOKING_TABLE_REGION!=='eu-west-2')
  throw Error('Staging SES feedback worker is disabled or incorrectly scoped');
 const productionEnabled=env.BOOKING_PRODUCTION_SES_FEEDBACK_ENABLED==='true';
 if(productionEnabled&&(!PRODUCTION_TABLE.test(env.BOOKING_PRODUCTION_FEEDBACK_TABLE??'')||
   env.BOOKING_PRODUCTION_FEEDBACK_TABLE===env.BOOKINGS_TABLE))
  throw Error('Explicit production feedback table required');
 return {queueArn:QUEUE_ARN,topicArn:TOPIC_ARN,table:env.BOOKINGS_TABLE,
  productionTable:productionEnabled?env.BOOKING_PRODUCTION_FEEDBACK_TABLE:null};
}
export function createSesFeedbackSqsHandler({
 env=process.env,
 dbFactory=()=>DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'})),
 verifierFactory=expectedTopicArn=>createSnsNotificationVerifier({expectedTopicArn}),
 reconcile=reconcileAuthenticatedSesFeedback
}={}){
 return async event=>{
  const config=validateSesFeedbackWorkerEnvironment(env);
  if(!Array.isArray(event?.Records)||event.Records.length<1||
     event.Records.length>10||event.Records.some(record=>
       record?.eventSource!=='aws:sqs'||
       record?.eventSourceARN!==config.queueArn||
       typeof record?.messageId!=='string'||!SQS_ID.test(record.messageId)||
       typeof record?.body!=='string'||record.body.length>262144))
   throw Error('Invalid staging SES feedback queue event');
  const verifyEnvelope=verifierFactory(config.topicArn);
  if(typeof verifyEnvelope!=='function')throw Error('SNS verifier required');
  const db=dbFactory();
  if(!db?.send)throw Error('DynamoDB document client required');
  const failures=[];
  try{
   for(const record of event.Records){
    try{
     let envelope;
     try{envelope=JSON.parse(record.body);}catch{throw Error('Invalid SNS envelope JSON');}
     if(!config.productionTable){
      await reconcile({db,table:config.table,notification:envelope,verifyEnvelope});
     }else{
      // Verify SNS before extracting a table key. The queue contains both environments.
      if(envelope.Type!=='Notification'||typeof envelope.Message!=='string'||
        !(await verifyEnvelope(envelope)))throw Error('Unverified SES feedback envelope');
      const payload=JSON.parse(envelope.Message);
      const {key}=parseSesFeedback(payload);
      const matches=[];
      for(const table of [config.table,config.productionTable]){
       const {Item}=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}));
       if(Item)matches.push(table);
      }
      // Never guess a destination table or acknowledge an ambiguous event.
      if(matches.length!==1)throw Error('SES feedback does not match exactly one outbox');
      await reconcile({db,table:matches[0],notification:envelope,verifyEnvelope});
     }
    }catch{
     // SQS retries only failed message IDs. Never acknowledge unsigned/mismatched
     // feedback as successful and never log personal data or the SNS payload.
     failures.push({itemIdentifier:record.messageId});
    }
   }
   return {batchItemFailures:failures};
  }finally{
   db.destroy?.();
  }
 };
}
