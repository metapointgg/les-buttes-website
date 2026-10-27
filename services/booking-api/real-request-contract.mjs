// Future real booking contract. Pure validation only: this module MUST NOT write records,
// send notifications, take payment or enable guest submissions.
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const iso=/^\d{4}-\d{2}-\d{2}$/;
const clean=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max?x.trim():null;
export function validateRealRequestDraft(input,terms){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid request');
 const firstName=clean(input.firstName,80),lastName=clean(input.lastName,80);
 const guestEmail=clean(input.email,254)?.toLowerCase();
 const telephone=clean(input.telephone,40);
 if(!firstName||!lastName||!guestEmail||!emailPattern.test(guestEmail)||
    !telephone||telephone.replace(/\D/g,'').length<7)throw Error('Guest contact details incomplete');
 if(!['geranium','honeysuckle','both'].includes(input.unit)||!iso.test(input.start??'')||
    !iso.test(input.end??'')||!Number.isInteger(input.adults)||input.adults<1||
    !Number.isInteger(input.children)||input.children<0)throw Error('Invalid stay or party');
 const party=input.adults+input.children;
 if(party>({geranium:4,honeysuckle:6,both:10})[input.unit])throw Error('Party exceeds capacity');
 const notes=input.notes??'';
 if(typeof notes!=='string'||notes.length>1000)throw Error('Invalid notes');
 if(!terms||terms.status!=='PUBLISHED'||typeof terms.version!=='number'||
    !Number.isSafeInteger(terms.version)||terms.version<1||
    typeof terms.digest!=='string'||!/^[a-f0-9]{64}$/.test(terms.digest))throw Error('Published terms unavailable');
 if(input.acceptedTerms!==true||input.acceptedCancellation!==true||
    input.acceptedTermsVersion!==terms.version||input.acceptedTermsDigest!==terms.digest)
    throw Error('Current booking terms and cancellation policy must be accepted');
 // Marketing consent is distinct and NEVER mandatory to request accommodation.
 if(input.marketingConsent!==undefined&&typeof input.marketingConsent!=='boolean')throw Error('Invalid marketing consent');
 return Object.freeze({unit:input.unit,start:input.start,end:input.end,
  adults:input.adults,children:input.children,
  guestName:firstName+' '+lastName,guestEmail,guestTelephone:telephone,notes,
  agreement:Object.freeze({termsVersion:terms.version,termsDigest:terms.digest,
   acceptedTerms:true,acceptedCancellation:true,marketingConsent:input.marketingConsent===true})});
}
