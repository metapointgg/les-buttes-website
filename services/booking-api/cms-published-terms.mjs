// Pages CMS source validator. Does not publish to AWS or enable real bookings.
import {createHash} from 'node:crypto';
const LANG=['termsText','cancellationText'];
const REQUIRED_STATUS='PUBLISHED';
export function derivePublishedBookingTerms(source){
 if(!source||source.status!==REQUIRED_STATUS||
    !Number.isSafeInteger(source.version)||source.version<1)
  throw Error('Published CMS terms unavailable');
 for(const key of LANG){
  if(typeof source[key]!=='string'||source[key].trim().length<40||
     source[key].length>100000)throw Error('Published CMS terms incomplete');
 }
 // Digest binds the English legal text AND cancellation wording, not a manually editable version label.
 const canonical=JSON.stringify({version:source.version,
  termsText:source.termsText,cancellationText:source.cancellationText});
 const digest=createHash('sha256').update(canonical,'utf8').digest('hex');
 return Object.freeze({status:REQUIRED_STATUS,version:source.version,digest});
}
