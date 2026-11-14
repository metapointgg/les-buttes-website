import {renderBrandedBookingHtml} from './booking-branded-email-html.mjs';
import {firstName} from './booking-payment-policy.mjs';
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
 balance_reminder:'balance_reminder_v1',
 declined:'declined_v1',
 confirmed:'confirmed_v1',
 cancelled:'cancelled_v1',
 refund_confirmed:'refund_confirmed_v1',
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
export function renderBookingLifecycleEmail({type,booking,checkout,reason,reminderStage}={}){
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
   subject=type==='owner_request'?'Les Buttes — New booking request awaiting approval':'Les Buttes — Booking request received';
   if(type==='owner_request'){
    const guest=clean(booking.guestName,{max:120});
    const email=clean(booking.guestEmail,{max:254});
    const telephone=clean(booking.guestTelephone,{max:40});
    const guests=booking.guests;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
       !/^[+0-9() .-]{7,40}$/.test(telephone)||
       !Number.isSafeInteger(guests)||guests<1||guests>10)
      throw Error('Verified guest contact details required for owner email');
    lines=['A new direct booking request is ready for your review.',
      stay,reference,'Guest: '+guest,'Guests: '+guests,'Email: '+email,'Telephone: '+telephone,
      ...(/^\d+\.\d{2}$/.test(booking.quotedPriceGBP??'')?['Quoted price: £'+booking.quotedPriceGBP]:[]),
      'Review the request in the owner management application before approving or declining.',
      'Owner management: https://lesbuttes.ozanne-family.com',
      'No payment has been taken. The guest has been told that the request is provisional.'];
   }else{
    lines=['Thank you for choosing Les Buttes. We have received your booking request.',
      stay,reference,
      'What happens next: we will check your request and email you once the owner has reviewed it.',
      'Your booking is not yet confirmed. No payment has been taken.'];
   }
   break;
  case 'approval_payment':{
   // An untrusted booking event cannot manufacture approval or payment amount.
   if(booking.status!=='APPROVED_AWAITING_PAYMENT'||
    !checkout||checkout.status!=='PENDING'||checkout.currency!=='GBP'||
    checkout.bookingId!==id||checkout.amountPence!==booking.approvedAmountPence)
    throw Error('Authoritative approved checkout required');
   const url=safeUrl(checkout.hostedCheckoutUrl);
   subject='Les Buttes — Booking approved: payment required';
   const balance=booking.balancePence??0;
   lines=['Your booking request has been approved. The next step is to pay securely to confirm your reservation.',
    stay,reference,'Amount due: '+money(checkout.amountPence),
    ...(balance>0?['Total holiday price: '+money(booking.approvedAmountPence),
      'Remaining balance: '+money(balance)+' due '+date(booking.balanceDueDate)]:[]),
    'Pay securely using the SumUp hosted checkout:',url,
    'Your booking will be confirmed once your payment has been verified. We will email you to confirm this.'];
   break;
  }
  case 'confirmed':
   if(booking.status!=='CONFIRMED'||booking.paymentVerified!==true)
    throw Error('Verified booking confirmation required');
   subject='Les Buttes – booking confirmed';
   lines=['Thank you for booking directly with Les Buttes. Your payment has been verified and your cottage is reserved for your stay.',stay,reference,
    ...(booking.balancePence>0?['Deposit received: '+money(booking.paidAmountPence),
       'Outstanding balance: '+money(booking.balancePence)+' due '+date(booking.balanceDueDate),
       'We will email you a secure link to pay the balance before it is due. You may also pay early.']:[]),
    'Check-in is from 4.00 pm and check-out is by 10.00 am. We will send you arrival information before your stay. We look forward to welcoming you to Guernsey.'];
   break;
  case 'balance_reminder':{
   if(booking.status!=='CONFIRMED'||!checkout||checkout.status!=='PENDING'||
      checkout.currency!=='GBP'||checkout.bookingId!==id||
      !Number.isSafeInteger(booking.balancePence)||booking.balancePence<1||
      checkout.amountPence!==booking.balancePence||
      ![3,2,1,0].includes(reminderStage))throw Error('Verified outstanding balance required');
   const url=safeUrl(checkout.hostedCheckoutUrl);
   const name=firstName(booking.guestName);
   const timing={3:'three months',2:'two months',1:'one month'};
   subject=reminderStage===0?'Les Buttes — Your holiday balance is now due':
     'Les Buttes — '+timing[reminderStage]+' until your holiday';
   lines=['Dear '+name+',',
    ...(reminderStage===0?
      ['Your holiday is just two weeks away, and we are looking forward to welcoming you to Les Buttes.',
       'The remaining balance for your stay is now due. Please use the secure payment link below.']:
      ['Your holiday is just '+timing[reminderStage]+' away and we are looking forward to welcoming you to Guernsey.',
       'If you would like to pay the remaining balance now, please use the secure SumUp link below.',
       'Otherwise, no action is needed just yet. We will send a further reminder as your holiday approaches.']),
    stay,reference,'Amount due: '+money(booking.balancePence),
    'Balance due date: '+date(booking.balanceDueDate),
    'Pay securely using the SumUp hosted checkout:',url,
    'We will confirm receipt when your payment has been verified.'];
   break;
  }
  case 'declined':
   if(booking.status!=='DECLINED')throw Error('Declined booking state required');
   subject='Les Buttes – booking request update';
   lines=['Thank you for your interest in Les Buttes. Unfortunately, we are unable to accept this booking request. Please contact us if you would like help with alternative dates.',stay,reference,
    'No payment is requested.'];
   break;
  case 'cancelled':
   if(booking.status!=='CANCELLED')throw Error('Cancelled booking state required');
   subject='Les Buttes – booking cancellation';
   // Cancellation never implies a refund. Verified refunds are communicated by a separate email.
   lines=['Your booking has been cancelled.',stay,reference,
    'If you did not request this cancellation, or are unsure why your booking was cancelled, please contact us immediately by replying to this email.',
    'If you would like to arrange another stay, please get in touch.'];
   break;
  case 'refund_confirmed':
   if(booking.status!=='CANCELLED'||booking.refundStatus!=='REFUNDED'||
     !Number.isSafeInteger(booking.refundedAmountPence)||booking.refundedAmountPence<1)
    throw Error('Verified refund required');
   subject='Les Buttes – refund confirmed';
   lines=['Your refund has been confirmed.',stay,reference,
    'Refund amount: '+money(booking.refundedAmountPence),
    'The refund was returned through the original payment method.'];
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
 return {type,templateId:type==='balance_reminder'?`balance_reminder_${reminderStage}_v1`:TYPES[type],bookingId:id,subject,body,
  html:renderBrandedBookingHtml({type,body})};
}
