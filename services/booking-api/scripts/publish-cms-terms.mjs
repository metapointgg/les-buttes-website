// Reviewed operator-only CLI. DRY RUN by default. Never run on a CMS webhook.
// Only publishes human-approved complete terms into the STAGING booking master.
import {readFile} from 'node:fs/promises';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {derivePublishedBookingTerms} from '../cms-published-terms.mjs';
import {buildApprovedTermsRelease} from '../booking-terms-store.mjs';

const argumentsList=process.argv.slice(2);
const valueOf=name=>{
 const prefix='--'+name+'=';
 const matches=argumentsList.filter(x=>x.startsWith(prefix));
 if(matches.length!==1)throw Error('Exactly one --'+name+'=... is required');
 return matches[0].slice(prefix.length);
};
const publish=argumentsList.includes('--publish');
const allowed=['publish','table','previous','approved-digest'];
if(argumentsList.some(x=>!allowed.some(k=>x==='--'+k||x.startsWith('--'+k+'='))))
 throw Error('Unknown release option');
const table=valueOf('table');
const previousVersion=Number(valueOf('previous'));
if(!Number.isSafeInteger(previousVersion)||previousVersion<0)throw Error('Invalid previous version');
const source=JSON.parse(await readFile(new URL('../../../src/data/booking-terms.json',import.meta.url),'utf8'));
const approval=derivePublishedBookingTerms(source);
let approvedDigest=approval.digest;
if(publish){
 approvedDigest=valueOf('approved-digest');
 if(!/^[a-f0-9]{64}$/.test(approvedDigest)||approval.digest!==approvedDigest)
  throw Error('Manual approved digest does not match CMS content');
}
const plan=buildApprovedTermsRelease({source,table,previousVersion,approvedDigest});
if(!publish){
 process.stdout.write(JSON.stringify({status:'DRY_RUN_ONLY',
  version:plan.version,digest:plan.digest,previousVersion,
  action:'Review terms, verify digest independently, then explicitly approve publication.'})+'\n');
}else{
 if(process.env.BOOKING_TERMS_RELEASE_AUTHORIZED!=='YES'||
    process.env.AWS_REGION!=='eu-west-2')throw Error('Staging release not authorized');
 const identity=await new STSClient({region:'eu-west-2'}).send(new GetCallerIdentityCommand({}));
 if(identity.Account!=='145608514666')throw Error('Wrong AWS account');
 const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
 await client.send(new TransactWriteCommand(plan.transactWrite));
 process.stdout.write(JSON.stringify({status:'PUBLISHED_TO_STAGING_MASTER',
  version:plan.version,digest:plan.digest})+'\n');
}
