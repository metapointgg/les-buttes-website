import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snsSigningString,snsCertificateUrl,createSnsNotificationVerifier} from './booking-sns-signature.mjs';

const topic='arn:aws:sns:us-east-1:145608514666:les-buttes-ses-staging';
const certUrl='https://sns.us-east-1.amazonaws.com/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem';
const timestamp=new Date().toISOString();
const makeNotification=()=>({Type:'Notification',Message:'{"eventType":"Delivery"}',MessageId:'a-message-id',
 Timestamp:timestamp,TopicArn:topic,SignatureVersion:'2',SigningCertURL:certUrl});
function makeTestCertificate(){
 const dir=mkdtempSync(join(tmpdir(),'lb-sns-test-'));
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),
   '-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=LocalTestOnly'],{stdio:'ignore'});
  return {key:readFileSync(join(dir,'key.pem'),'utf8'),
   certificate:readFileSync(join(dir,'cert.pem'),'utf8')};
 }finally{rmSync(dir,{force:true,recursive:true});}
}
test('LB-09 SNS canonical string includes only signed Notification fields in the AWS order',()=>{
 const msg=makeNotification();
 assert.equal(snsSigningString(msg),
  'Message\n'+msg.Message+'\nMessageId\n'+msg.MessageId+'\nTimestamp\n'+msg.Timestamp+
  '\nTopicArn\n'+msg.TopicArn+'\nType\nNotification\n');
 assert.match(snsSigningString({...msg,Subject:'SES result'}),/Subject\nSES result\n/);
});
test('LB-09 SNS certificate URL accepts only the expected AWS regional signing endpoint',()=>{
 assert.equal(snsCertificateUrl({SigningCertURL:certUrl}),certUrl);
 for(const url of [
  'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem',
  'https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem',
  'https://sns.eu-west-2.amazonaws.com/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem',
  'https://sns.us-east-1.amazonaws.com@evil.test/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem',
  'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem?redirect=1',
  'https://sns.us-east-1.amazonaws.com/other.pem',
  'https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-1234567890abcdef1234567890abcdef.pem'
 ])assert.throws(()=>snsCertificateUrl({SigningCertURL:url}),undefined,url);
});
test('LB-09 verifies real RSA-SHA256 signature over SNS canonical notification, then rejects tampering',async()=>{
 const {key,certificate}=makeTestCertificate(),base=makeNotification();
 const sign=message=>{
  const signer=createSign('RSA-SHA256');
  signer.update(snsSigningString(message),'utf8');signer.end();
  return {...message,Signature:signer.sign(key).toString('base64')};
 };
 let reads=0;
 const verify=createSnsNotificationVerifier({expectedTopicArn:topic,
  now:()=>Date.parse(timestamp),loadCertificate:async url=>{reads++;assert.equal(url,certUrl);return certificate;}});
 const valid=sign(base);
 assert.equal(await verify(valid),true);
 assert.equal(reads,1);
 assert.equal(await verify({...valid,Message:'{"eventType":"Bounce"}'}),false);
 assert.equal(await verify({...valid,TopicArn:'arn:aws:sns:us-east-1:145608514666:other-topic'}),false);
 assert.equal(await verify({...valid,SignatureVersion:'3'}),false);
 assert.equal(await verify({...valid,Signature:'not-base64'}),false);
 assert.equal(await verify({...valid,Timestamp:'2026-01-01T00:00:00.000Z'}),false);
 assert.equal(await verify({...valid,Type:'SubscriptionConfirmation'}),false);
 assert.equal(reads,2); // only valid and tampered signed payload fetch cert
});
test('LB-09 requires an explicit SNS topic from the exact account and region',()=>{
 for(const topicArn of [undefined,'*','arn:aws:sns:eu-west-2:145608514666:topic',
  'arn:aws:sns:us-east-1:999999999999:topic'])
  assert.throws(()=>createSnsNotificationVerifier({expectedTopicArn:topicArn}));
});
