// Approved Pages CMS terms release protocol for the STAGING booking master.
// Source is editorial CMS content, never user input. A validated immutable version
// and the CURRENT pointer are created atomically by an authorised release operator.
// No publication or AWS write happens merely by importing this module.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {derivePublishedBookingTerms} from './cms-published-terms.mjs';

const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const PK='CONFIG#booking-terms',CURRENT='CURRENT';
const versionKey=v=>'VERSION#'+String(v).padStart(10,'0');
const validVersion=v=>Number.isSafeInteger(v)&&v>0&&v<=9999999999;

export function buildApprovedTermsRelease({source,table,approvedDigest,previousVersion=0,
 now=new Date()}){
 if(!TABLE.test(table??''))throw Error('Staging booking master required');
 if(!validVersion(source?.version)||!Number.isSafeInteger(previousVersion)||
    previousVersion<0||previousVersion>=source.version)throw Error('Invalid policy release version');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Invalid publication timestamp');
 const terms=derivePublishedBookingTerms(source);
 if(typeof approvedDigest!=='string'||terms.digest!==approvedDigest)
  throw Error('Separately approved terms digest required');
 const publishedAt=now.toISOString();
 const version={PK,SK:versionKey(terms.version),status:'PUBLISHED',version:terms.version,
  digest:terms.digest,publishedAt,termsText:source.termsText,
  cancellationText:source.cancellationText};
 const current={PK,SK:CURRENT,status:'PUBLISHED',version:terms.version,
  digest:terms.digest,versionKey:version.SK,publishedAt};
 const pointerCondition=previousVersion===0?'attribute_not_exists(PK)':
  'attribute_exists(PK) AND #version = :previous';
 const pointer={TableName:table,Item:current,ConditionExpression:pointerCondition};
 if(previousVersion!==0){
  pointer.ExpressionAttributeNames={'#version':'version'};
  pointer.ExpressionAttributeValues={':previous':previousVersion};
 }
 return Object.freeze({status:'RELEASE_PLAN_ONLY',version:terms.version,digest:terms.digest,
  summary:{version:terms.version,previousVersion,publishedAt},
  // Authorized release tooling only. Never include legal text in logs or public responses.
  transactWrite:{TransactItems:[
   {Put:{TableName:table,Item:version,ConditionExpression:'attribute_not_exists(PK)'}},
   {Put:pointer}
  ]}});
}

export async function readApprovedTermsFromMaster({db,table}){
 if(!db||typeof db.send!=='function'||!TABLE.test(table??''))
  throw Error('Published CMS terms unavailable');
 const lookup=async(SK)=>(await db.send(new GetCommand({TableName:table,
  Key:{PK,SK},ConsistentRead:true})))?.Item;
 const current=await lookup(CURRENT);
 if(current?.status!=='PUBLISHED'||!validVersion(current.version)||
    current.versionKey!==versionKey(current.version)||
    typeof current.digest!=='string'||!/^[a-f0-9]{64}$/.test(current.digest))
  throw Error('Published CMS terms unavailable');
 const immutable=await lookup(current.versionKey);
 if(immutable?.status!=='PUBLISHED'||immutable.version!==current.version||
    immutable.digest!==current.digest||immutable.SK!==current.versionKey)
  throw Error('Published CMS terms unavailable');
 const derived=derivePublishedBookingTerms(immutable);
 if(derived.digest!==current.digest)throw Error('Published CMS terms unavailable');
 return derived;
}
