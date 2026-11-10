import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./staging-ses-feedback-worker.template.yaml',import.meta.url),'utf8');
const handler=readFileSync(new URL('./booking-ses-feedback-worker.mjs',import.meta.url),'utf8');

test('LB-09 worker is inert by default and only accepts approved US East staging events',()=>{
 assert.match(source,/IsApprovedRegion: !Equals \[!Ref AWS::Region, us-east-1\]/);
 assert.match(source,/Enabled: false/);
 assert.match(source,/FunctionResponseTypes:\s*\n\s*- ReportBatchItemFailures/);
 assert.match(source,/BOOKING_ENVIRONMENT: staging/);
 assert.match(source,/BOOKING_SES_FEEDBACK_ENABLED: 'true'/);
 assert.match(source,/BOOKING_SES_FEEDBACK_QUEUE_ARN: arn:aws:sqs:us-east-1:145608514666:les-buttes-ses-feedback-staging/);
 assert.match(source,/BOOKING_SES_FEEDBACK_TOPIC_ARN: arn:aws:sns:us-east-1:145608514666:les-buttes-ses-feedback-staging/);
});
test('LB-09 worker can only read or update staging booking-table email outbox, not operate payments',()=>{
 assert.match(source,/BOOKING_TABLE_REGION: eu-west-2/);
 assert.match(source,/les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK/);
 for(const permission of ['dynamodb:GetItem','dynamodb:UpdateItem',
  'sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes'])
  assert.ok(source.includes(permission),permission);
 for(const forbidden of ['dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:TransactWriteItems',
  'ses:SendEmail','sqs:SendMessage','sns:Publish','AWS::DynamoDB::Table',
  'AWS::SNS::Topic','AWS::SES::ConfigurationSetEventDestination'])
  assert.ok(!source.includes(forbidden),forbidden);
});
test('LB-09 worker uses signed SQS feedback handler only',()=>{
 assert.match(handler,/createSesFeedbackSqsHandler/);
 assert.match(handler,/export const handler=createSesFeedbackSqsHandler\(\)/);
 assert.ok(!handler.includes('SendEmailCommand'));
});
