import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const template=readFileSync(new URL('../../infra/booking-api/lb09-ses-feedback-staging-us-east-1.template.yaml',import.meta.url),'utf8');

test('LB-09 SES feedback stack never creates booking, payment, Lambda or guest-send resources',()=>{
 for(const forbidden of [
  'AWS::DynamoDB::Table','AWS::Lambda::Function',
  'AWS::SES::EmailIdentity','AWS::SES::ConfigurationSet\n',
  'AWS::IAM::Role','AWS::ApiGateway::RestApi',
  'AWS::Serverless::Function','cloudformation:ExecuteChangeSet'
 ])assert.ok(!template.includes(forbidden),forbidden);
 assert.match(template,/SesConfigurationSetName:/);
 assert.match(template,/Default: my-first-configuration-set/);
 assert.match(template,/AllowedValues:/);
});
test('LB-09 SNS topic can only be published to by SES for the expected account and configuration set',()=>{
 assert.match(template,/Principal:\s*\n\s*Service: ses\.amazonaws\.com/);
 assert.match(template,/Action: sns:Publish/);
 assert.match(template,/AWS:SourceAccount: !Ref AwsAccountId/);
 assert.match(template,/AWS:SourceArn: !Sub/);
 assert.match(template,/configuration-set\/\$\{SesConfigurationSetName\}/);
});
test('LB-09 SQS subscription preserves signed SNS envelope and isolates poison messages',()=>{
 assert.match(template,/RawMessageDelivery: false/);
 assert.match(template,/Protocol: sqs/);
 assert.match(template,/Action: sqs:SendMessage/);
 assert.match(template,/aws:SourceArn: !Ref SesFeedbackTopic/);
 assert.match(template,/RedrivePolicy:/);
 assert.match(template,/deadLetterTargetArn: !GetAtt SesFeedbackDeadLetterQueue\.Arn/);
 assert.equal((template.match(/SqsManagedSseEnabled: true/g)??[]).length,2);
});
test('LB-09 only forwards delivery, bounce and complaint from existing SES configuration set',()=>{
 assert.match(template,/Type: AWS::SES::ConfigurationSetEventDestination/);
 assert.match(template,/ConfigurationSetName: !Ref SesConfigurationSetName/);
 assert.match(template,/MatchingEventTypes:\s*\n\s*- delivery\s*\n\s*- bounce\s*\n\s*- complaint/);
 assert.match(template,/SNSDestination:\s*\n\s*TopicARN: !Ref SesFeedbackTopic/);
});
