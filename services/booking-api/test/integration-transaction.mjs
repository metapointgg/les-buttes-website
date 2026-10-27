// Run only against the purpose-created isolated test table, never booking staging/production.
// Uses mock encrypted bytes: AWS KMS was verified separately. No real customer information.
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand,ScanCommand,DeleteCommand} from '@aws-sdk/lib-dynamodb';
import {prepareRealBookingStorage} from '../real-booking-storage.mjs';
import {planRealBookingTransaction} from '../real-booking-transaction.mjs';

const table=process.env.SYNTHETIC_TRANSACTION_TABLE;
if(!/^les-buttes-booking-transaction-test-[A-Za-z0-9-]+$/.test(table??'')||
 process.env.BOOKING_ENVIRONMENT!=='staging'||process.env.BOOKING_REAL_GUEST_WRITES==='true')
 throw Error('Isolated transaction test table and staging flags required');
process.env.BOOKING_TRANSACTION_ISOLATED_TEST='true';
const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
const spans=[['low','2027-03-20','2027-04-24',3],['shoulder','2027-04-24','2027-06-26',5],['peak','2027-06-26','2027-08-28',7],['shoulder','2027-08-28','2027-09-25',5],['low','2027-09-25','2027-10-02',3]];
const rates=(peak)=>({version:1,value:{bands:spans.map(([season,start,end,minNights])=>
 ({season,start,end,minNights,nightlyGBP:String(season==='peak'?peak:100)}))}});
const pricing={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',cottages:{geranium:rates(155),honeysuckle:rates(140)}};
const availability={mode:'LIVE_STAGING_MASTER_READ_ONLY',blocked:{geranium:[],honeysuckle:[]}};
const terms={status:'PUBLISHED',version:1,digest:'a'.repeat(64)};
const request={unit:'both',start:'2027-07-10',end:'2027-07-17',adults:5,children:1,
 firstName:'SYNTHETIC',lastName:'TEST',email:'nobody@example.invalid',telephone:'0000000000',
 notes:'SYNTHETIC FIXTURE ONLY',acceptedTerms:true,acceptedCancellation:true,
 acceptedTermsVersion:1,acceptedTermsDigest:terms.digest};
const runId=randomUUID();
const prepared=(ref,key)=>prepareRealBookingStorage({request,terms,reference:ref,requestKey:key});
const encrypt=async()=>Buffer.alloc(128,7);
async function plan(ref,key){
 return planRealBookingTransaction({prepared:prepared(ref,key),availability,pricing,
  tableName:table,encrypt,nowEpoch:Math.floor(Date.now()/1000)});
}
function check(ok,message){if(!ok)throw Error(message);}
async function get(PK,SK){return (await client.send(new GetCommand({TableName:table,Key:{PK,SK},ConsistentRead:true}))).Item;}
async function transact(plan){
 // Deliberately no retry: any error must be diagnosed rather than creating another test reservation.
 return client.send(new TransactWriteCommand({...plan.transactWrite,ClientRequestToken:plan.reference}));
}
let owned=[];
let committedReference=null;
try{
 const initial=await client.send(new ScanCommand({TableName:table,Select:'COUNT'}));
 check(initial.Count===0&&!initial.LastEvaluatedKey,'Test table must be empty before starting');
 const one=randomUUID(),two=randomUUID();
 const first=await plan(one,'synthetic-run-'+runId+'-first');
 owned=first.transactWrite.TransactItems.map(x=>({PK:x.Put.Item.PK,SK:x.Put.Item.SK}));
 check(owned.length===17,'Expected 17 conditional items');
 await transact(first);
 committedReference=one;
 check((await get('BOOKING#'+one,'META'))?.id===one,'Missing committed booking');
 check((await get('GUEST#'+one,'CONTACT'))?.keyType==='AWS_KMS','Missing mock ciphertext record');
 check((await get('UNIT#geranium','DATE#2027-07-10'))?.id===one,'Missing date hold');
 // ClientRequestToken makes exact replays idempotent for a 10-minute DynamoDB window.
 await transact(first);
 const colliding=await plan(two,'synthetic-run-'+runId+'-second');
 let collision=false;
 try{await transact(colliding)}catch(e){collision=e.name==='TransactionCanceledException';if(!collision)throw e;}
 check(collision,'Overlapping dates must fail transaction');
 check(!(await get('BOOKING#'+two,'META')),'Conflicting request left a partial booking');
 check(!(await get('GUEST#'+two,'CONTACT')),'Conflicting request left a private record');
 const scan=await client.send(new ScanCommand({TableName:table,Select:'COUNT'}));
 check(scan.Count===17&&!scan.LastEvaluatedKey,'Unexpected item count after conflicts');
 process.stdout.write('PASS: atomic booking, mock encrypted contact, idempotent retry, overlap rejected, no partial writes.\n');
}finally{
 // Cleanup deletes only keys captured from the first synthetic transaction.
 // Concurrent or foreign records cannot be deleted; table must have been initially empty.
 for(const key of owned){
  if(!committedReference)break;
  try{
   let condition,values;
   if(key.PK.startsWith('UNIT#')||key.PK.startsWith('BOOKING#')){
    condition='id = :ref';values={':ref':committedReference};
   }else if(key.PK.startsWith('GUEST#')){
    condition='context.bookingId = :ref';values={':ref':committedReference};
   }else{
    condition='bookingId = :ref';values={':ref':committedReference};
   }
   await client.send(new DeleteCommand({TableName:table,Key:key,
    ConditionExpression:condition,ExpressionAttributeValues:values}));
  }catch(e){process.stderr.write('Cleanup failed; inspect isolated table before reuse: '+e.name+'\\n');}
 }
 const remaining=await client.send(new ScanCommand({TableName:table,Select:'COUNT'}));
 check(remaining.Count===0&&!remaining.LastEvaluatedKey,'Synthetic table cleanup incomplete');
}
