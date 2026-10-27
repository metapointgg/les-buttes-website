// Private, explicitly gated, SYNTHETIC-ONLY KMS + DynamoDB integration test.
// No API trigger or customer input. Never use the shared booking master.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand,DeleteCommand,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {prepareRealBookingStorage} from './real-booking-storage.mjs';
import {planRealBookingTransaction} from './real-booking-transaction.mjs';
import {validatePrivateTransactionPlan} from './real-booking-transaction-safety.mjs';

const TABLE=/^les-buttes-booking-transaction-test-SyntheticTransactionTable-[A-Za-z0-9]+$/;
const KEY=/^arn:aws:kms:eu-west-2:145608514666:key\/[a-f0-9-]{36}$/;
const safe=(statusCode,message)=>({statusCode,body:JSON.stringify({message})});
const spans=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],['low','2027-09-25','2027-10-02',3]];
const rate=(peak)=>({version:1,value:{bands:spans.map(([season,start,end,minNights])=>({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}});
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{geranium:rate(155),honeysuckle:rate(140)}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const terms={status:'PUBLISHED',version:1,digest:'a'.repeat(64)};
const request={unit:'both',start:'2027-07-10',end:'2027-07-17',adults:5,children:1,
 firstName:'SYNTHETIC',lastName:'TEST',email:'nobody@example.invalid',telephone:'0000000000',
 notes:'SYNTHETIC FIXTURE ONLY',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:1,acceptedTermsDigest:terms.digest};

export async function runPrivateIntegrationTest({db,kms,table,keyArn,nowEpoch=Math.floor(Date.now()/1000)}){
 if(!TABLE.test(table??'')||!KEY.test(keyArn??''))throw Error('Test resources required');
 const count=await db.send(new ScanCommand({TableName:table,Select:'COUNT',ConsistentRead:true}));
 if(count.Count!==0||count.LastEvaluatedKey)throw Error('Test table is not empty');
 const ref=randomUUID(),other=randomUUID(),run=randomUUID();
 const encrypt=async(data,context)=>{
  const {EncryptCommand}=await import('@aws-sdk/client-kms');
  const res=await kms.send(new EncryptCommand({KeyId:keyArn,Plaintext:data,EncryptionContext:context}));
  if(res.KeyId!==keyArn||!res.CiphertextBlob)throw Error('KMS encrypt failed');
  return Buffer.from(res.CiphertextBlob);
 };
 const make=async(id,suffix)=>{
  const prepared=prepareRealBookingStorage({request,terms,reference:id,requestKey:'synthetic-'+run+'-'+suffix});
  return planRealBookingTransaction({prepared,availability,pricing,tableName:table,nowEpoch,encrypt});
 };
 const get=async(PK,SK)=>(await db.send(new GetCommand({TableName:table,Key:{PK,SK},ConsistentRead:true}))).Item;
 let owned=[],committed=false,passed=false,cleanupOk=false;
 try{
  const first=await make(ref,'first');
  validatePrivateTransactionPlan(first,table);
  owned=first.transactWrite.TransactItems.map(({Put})=>({PK:Put.Item.PK,SK:Put.Item.SK}));
  if(owned.length!==17)throw Error('Wrong test record count');
  await db.send(new TransactWriteCommand(first.transactWrite));
  committed=true;
  const guest=await get('GUEST#'+ref,'CONTACT');
  if(guest?.keyType!=='AWS_KMS'||!guest.ciphertext||guest?.context?.bookingId!==ref)
   throw Error('Encrypted contact was not stored');
  const row=await get('BOOKING#'+ref,'META');
  if(row?.id!==ref||row?.quote?.totalGBP!==2065)throw Error('Booking metadata missing');
  await db.send(new TransactWriteCommand(first.transactWrite));
  const conflicting=await make(other,'second');
  let failed=false;
  try{await db.send(new TransactWriteCommand(conflicting.transactWrite));}
  catch(error){if(error.name==='TransactionCanceledException')failed=true;else throw error;}
  if(!failed||await get('BOOKING#'+other,'META')||await get('GUEST#'+other,'CONTACT'))
   throw Error('Conflict was not atomic');
  const total=await db.send(new ScanCommand({TableName:table,Select:'COUNT',ConsistentRead:true}));
  if(total.Count!==17||total.LastEvaluatedKey)throw Error('Unexpected test records');
  passed=true;
 }finally{
  // Delete only the test's own booking-owned records. Never delete shared-master slots.
  if(committed){
   for(const {PK,SK} of owned){
    const attr=PK.startsWith('UNIT#')||PK.startsWith('BOOKING#')?'id':
     PK.startsWith('GUEST#')?'context.bookingId':'bookingId';
    try{await db.send(new DeleteCommand({TableName:table,Key:{PK,SK},
      ConditionExpression:attr+' = :ref',ExpressionAttributeValues:{':ref':ref}}));}
    catch{cleanupOk=false;throw Error('Integration cleanup failed; inspect isolated table');}
   }
  }
  const remainder=await db.send(new ScanCommand({TableName:table,Select:'COUNT',ConsistentRead:true}));
  cleanupOk=remainder.Count===0&&!remainder.LastEvaluatedKey;
  if(!cleanupOk)throw Error('Integration test table not empty after cleanup');
 }
 if(!passed||!cleanupOk)throw Error('Integration verification incomplete');
 return {result:'PASS',synthetic:true,recordCount:17,slotCount:14,kmsEncryption:'AWS_KMS',cleaned:true};
}

export async function handler(event){
 if(process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.BOOKING_REAL_GUEST_WRITES!=='false'||
    process.env.BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED!=='true'||
    event?.operation!=='SYNTHETIC_PRIVATE_INTEGRATION_TEST'||
    Object.keys(event).length!==1)return safe(403,'Private test disabled');
 const table=process.env.SYNTHETIC_TRANSACTION_TABLE,keyArn=process.env.GUEST_CONTACT_KMS_KEY_ARN;
 if(!TABLE.test(table??'')||!KEY.test(keyArn??''))return safe(403,'Private test disabled');
 try{
  process.env.BOOKING_TRANSACTION_ISOLATED_TEST='true';
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
  const {KMSClient}=await import('@aws-sdk/client-kms');
  const kms=new KMSClient({region:'eu-west-2'});
  const result=await runPrivateIntegrationTest({db,kms,table,keyArn});
  return {statusCode:200,body:JSON.stringify(result)};
 }catch{
  // No exception text, ciphertext or guest details logged or returned.
  return safe(500,'Private integration test failed; inspect the isolated table before retrying');
 }
}
