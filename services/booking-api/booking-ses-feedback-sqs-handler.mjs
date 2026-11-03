// LB-09: staging-only SQS event-source adapter for SES delivery feedback.
// Deploy (if approved) in us-east-1 alongside the SQS queue; DynamoDB is eu-west-2.
// No guest email sends, booking state writes, or payment actions.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createSnsNotificationVerifier} from './booking-sns-signature.mjs';
import {reconcileAuthenticatedSesFeedback} from './booking-ses-feedback.mjs';

const QUEUE_ARN='arn:aws:sqs:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const TOPIC_ARN='arn:aws:sns:us-east-1:145608514666:les-buttes-ses-feedback-staging';
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
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
 return {queueArn:QUEUE_ARN,topicArn:TOPIC_ARN,table:env.BOOKINGS_TABLE};
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
     await reconcile({db,table:config.table,notification:envelope,verifyEnvelope});
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
