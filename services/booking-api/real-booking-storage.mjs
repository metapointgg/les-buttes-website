// Infrastructure foundation only. NOT connected to HTTP endpoints or staging synthetic routes.
// Guest PII is encrypted using a caller-provided KMS encrypt operation BEFORE persistence.
// No plaintext contact details, notes or token values are placed in reservation metadata.
import {createHash,randomUUID} from 'node:crypto';
import {validateRealRequestDraft} from './real-request-contract.mjs';

const bookingIdPattern=/^[a-f0-9-]{36}$/;
const keyPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/;
const stableHash=value=>createHash('sha256').update(value).digest('hex');

export function prepareRealBookingStorage({request,terms,requestKey,now=new Date(),reference=randomUUID()}){
 const guest=validateRealRequestDraft(request,terms);
 if(typeof requestKey!=='string'||!keyPattern.test(requestKey))throw Error('Invalid idempotency key');
 if(typeof reference!=='string'||!bookingIdPattern.test(reference))throw Error('Invalid booking reference');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Invalid timestamp');
 const time=now.toISOString();
 const scope=stableHash('real-booking-request:'+requestKey);
 const contact={guestName:guest.guestName,guestEmail:guest.guestEmail,
  guestTelephone:guest.guestTelephone,notes:guest.notes};
 const publicMetadata={id:reference,source:'direct',synthetic:false,status:'REQUESTED',
  unit:guest.unit,units:guest.unit==='both'?['geranium','honeysuckle']:[guest.unit],
  start:guest.start,end:guest.end,guests:guest.adults+guest.children,
  adults:guest.adults,children:guest.children,requestedAt:time,
  acceptance:{...guest.agreement,acceptedAt:time},piiReference:'GUEST#'+reference};
 // Binding encrypted data to its booking prevents ciphertext swapping.
 const encryptionContext={application:'les-buttes-booking',environment:'staging',bookingId:reference};
 return {reference,scope,contact,publicMetadata,encryptionContext};
}

export async function buildEncryptedRealBookingItems({prepared,encrypt,tableName,retentionEpoch}){
 if(!prepared||typeof encrypt!=='function'||typeof tableName!=='string'||!tableName||
    !Number.isSafeInteger(retentionEpoch)||retentionEpoch<=Math.floor(Date.now()/1000))
  throw Error('Encrypted storage configuration required');
 const plaintext=Buffer.from(JSON.stringify(prepared.contact),'utf8');
 let ciphertext;
 try{
  ciphertext=await encrypt(plaintext,prepared.encryptionContext);
 }finally{
  plaintext.fill(0);
 }
 if(!Buffer.isBuffer(ciphertext)||ciphertext.byteLength<32)throw Error('KMS encryption failed');
 // Intentionally return *unexecuted* put items. The future service must compose these
 // with atomic availability holds and idempotency records in a single transaction.
 return [
  {Put:{TableName:tableName,Item:{PK:'BOOKING#'+prepared.reference,SK:'META',
   ...prepared.publicMetadata},ConditionExpression:'attribute_not_exists(PK)'}},
  {Put:{TableName:tableName,Item:{PK:'GUEST#'+prepared.reference,SK:'CONTACT',
   ciphertext: ciphertext.toString('base64'),keyType:'AWS_KMS',retentionEpoch,
   context:prepared.encryptionContext},ConditionExpression:'attribute_not_exists(PK)'}},
  {Put:{TableName:tableName,Item:{PK:'IDEMPOTENCY#'+prepared.scope,SK:'REQUEST',
   bookingId:prepared.reference,expiresAt:retentionEpoch},
   ConditionExpression:'attribute_not_exists(PK)'}}
 ];
}
