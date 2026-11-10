const VERSION='LB-DIRECT-2027-01';
const PRIVACY='LB-PRIVACY-2027-01';

export function validateTermsAcceptance({acceptance,termsRecord,now=new Date()}={}){
 if(!termsRecord||termsRecord.PK!=='CONFIG#terms#all'||termsRecord.SK!=='CURRENT'||
   termsRecord.value?.termsVersion!==VERSION||termsRecord.value?.privacyVersion!==PRIVACY||
   typeof termsRecord.value?.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(termsRecord.value.contentSha256))
  throw Error('Published guest terms unavailable');
 if(!acceptance||acceptance.accepted!==true||acceptance.termsVersion!==VERSION||
   acceptance.privacyVersion!==PRIVACY)throw Error('Current guest terms acceptance required');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Invalid acceptance time');
 return {termsVersion:VERSION,privacyVersion:PRIVACY,
  termsContentSha256:termsRecord.value.contentSha256,termsAcceptedAt:now.toISOString()};
}

export const APPROVED_TERMS_VERSION=VERSION;
export const APPROVED_PRIVACY_VERSION=PRIVACY;
