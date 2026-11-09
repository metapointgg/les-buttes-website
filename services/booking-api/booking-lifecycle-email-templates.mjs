// LB-09: pure lifecycle email templates; never sends, charges, confirms payment or edits bookings.
// Only verified/authoritative inputs supplied by the calling orchestration may be rendered.
// The owner must approve customer-facing wording before any staging/production enablement.
const ID=/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const COTTAGES=new Set(['Geranium','Honeysuckle','Geranium and Honeysuckle']);
const TYPES=Object.freeze({
 requested:'requested_v1',
 owner_request:'owner_request_v1',
 approval_payment:'approval_payment_v1',
 declined:'declined_v1',
 confirmed:'confirmed_v1',
 cancelled:'cancelled_v1',
 hold_expired:'hold_expired_v1',
 delivery_failure:'delivery_failure_v1'
});
const clean=(value,{max=200,required=true}={})=>{
 if(typeof value!=='string'||value.length>max||/[\r\n\x00-\x1f\x7f]/.test(value)||
  (required&&!value.trim()))throw Error('Invalid email content field');
 return value.trim();
};
const date=value=>{
 if(typeof value!=='string'||!DATE.test(value))throw Error('Invalid booking date');
 const d=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
  throw Error('Invalid booking date');
 return value;
};
const money=value=>{
 if(!Number.isSafeInteger(value)||value<1||value>100000000)
  throw Error('Invalid verified amount');
 return '£'+(value/100).toFixed(2);
};
const safeUrl=value=>{
 if(typeof value!=='string'||value.length>2048)throw Error('Invalid checkout URL');
 let parsed;
 try{parsed=new URL(value);}catch{throw Error('Invalid checkout URL');}
 if(parsed.protocol!=='https:'||parsed.hostname!=='checkout.sumup.com'||
  parsed.username||parsed.password||parsed.hash)throw Error('Untrusted checkout URL');
 return parsed.toString();
};
export function renderBookingLifecycleEmail({type,booking,checkout,reason}={}){
 if(!Object.hasOwn(TYPES,type))throw Error('Unsupported lifecycle email type');
 if(!booking||!ID.test(booking.bookingId??''))throw Error('Invalid booking reference');
 const id=booking.bookingId;
 const property=clean(booking.cottage,{max:40});
 if(!COTTAGES.has(property))throw Error('Unsupported cottage');
 const arrival=date(booking.checkIn),departure=date(booking.checkOut);
 if(arrival>=departure)throw Error('Invalid booking dates');
 const reference='Booking reference: '+id;
 const stay=property+' | '+arrival+' to '+departure;
 const footer='Les Buttes Holiday Cottages\nPlease reply to the email you received if you need assistance.';
 let subject,lines;
 switch(type){
  case 'requested':
  case 'owner_request':
   if(booking.status!=='REQUESTED')throw Error('Requested booking state required');
   subject=type==='owner_request'?'Les Buttes – booking request awaiting review':'Les Buttes – booking request received';
   lines=[type==='owner_request'?'A booking request is awaiting your review in the management application.':'We have received your booking request.',
    stay,reference,'The reservation is provisional and requires owner approval. No payment has been taken.'];
   break;
  case 'approval_payment':{
   // An untrusted booking event cannot manufacture approval or payment amount.
   if(booking.status!=='APPROVED_AWAITING_PAYMENT'||
    !checkout||checkout.status!=='PENDING'||checkout.currency!=='GBP'||
    checkout.bookingId!==id||checkout.amountPence!==booking.approvedAmountPence)
    throw Error('Authoritative approved checkout required');
   const url=safeUrl(checkout.hostedCheckoutUrl);
   subject='Les Buttes – complete your booking payment';
   lines=['Your booking request has been approved, subject to payment.',
    stay,reference,'Amount due: '+money(checkout.amountPence),
    'Pay securely using the SumUp hosted checkout:',url,
    'Your reservation is not confirmed until payment has been verified.'];
   break;
  }
  case 'confirmed':
   if(booking.status!=='CONFIRMED'||booking.paymentVerified!==true)
    throw Error('Verified booking confirmation required');
   subject='Les Buttes – booking confirmed';
   lines=['Your reservation is confirmed.',stay,reference,
    'We will provide your arrival information separately.'];
   break;
  case 'declined':
   if(booking.status!=='DECLINED')throw Error('Declined booking state required');
   subject='Les Buttes – booking request update';
   lines=['We are sorry, but we cannot accept your booking request.',stay,reference,
    'No payment is requested.'];
   break;
  case 'cancelled':
   if(booking.status!=='CANCELLED')throw Error('Cancelled booking state required');
   subject='Les Buttes – booking cancellation';
   lines=['Your booking has been cancelled.',stay,reference,
    'Any refund will be assessed and communicated separately; this email does not confirm a refund.'];
   break;
  case 'hold_expired':
   if(booking.status!=='EXPIRED')throw Error('Expired booking state required');
   subject='Les Buttes – booking request expired';
   lines=['Your booking request has expired.',stay,reference,
    'If you would still like to stay, please submit a new enquiry.'];
   break;
  case 'delivery_failure':
   if(booking.status!=='DELIVERY_FAILURE')throw Error('Delivery failure state required');
   subject='Les Buttes – booking correspondence requires attention';
   lines=['We were unable to complete a booking correspondence action.',stay,reference,
    'Please contact us to confirm the current status of your reservation.'];
   break;
 }
 if(reason!==undefined)clean(reason,{max:300}); // Never echo unreviewed operational notes.
 const body=[...lines,'',footer].join('\n');
 if(body.length>15000||subject.length>160)throw Error('Rendered email too long');
 return {type,templateId:TYPES[type],bookingId:id,subject,body};
}
