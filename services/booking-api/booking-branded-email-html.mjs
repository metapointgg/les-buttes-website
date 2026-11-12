// Email-safe, image-free Les Buttes layout. HTML is derived solely from the validated plain-text message.
const titles={
 requested:'Thank you for your booking request',
 owner_request:'A booking needs your review',
 approval_payment:'Your booking has been approved',
 declined:'An update on your booking request',
 confirmed:'Your stay is confirmed',
 cancelled:'Your booking has been cancelled',
 refund_confirmed:'Your refund has been confirmed',
 hold_expired:'Your booking request has expired',
 delivery_failure:'Please contact us about your booking'
};
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const textRow=value=>'<p style="margin:0 0 14px;color:#33483f;font-size:15px;line-height:1.65;">'+escapeHtml(value)+'</p>';
export function renderBrandedBookingHtml({type,body}={}){
 if(typeof body!=='string'||body.length>15000||!Object.hasOwn(titles,type))
  throw Error('Invalid branded email input');
 const lines=body.split('\n').map(s=>s.trim()).filter(Boolean);
 const stay=lines.find(x=>/^(?:Geranium|Honeysuckle|Geranium and Honeysuckle) \| \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d$/.test(x));
 const reference=lines.find(x=>/^Booking reference: [0-9a-f-]{36}$/i.test(x));
 if(!stay||!reference)throw Error('Verified stay details required');
 const amount=lines.find(x=>/^(?:Amount due|Refund amount): £\d+\.\d{2}$/.test(x));
 const candidate=lines.find(x=>x.startsWith('https://'));
 let paymentUrl;
 if(type==='approval_payment'){
  if(!candidate)throw Error('Verified SumUp link required');
  const url=new URL(candidate);
  if(url.protocol!=='https:'||url.hostname!=='checkout.sumup.com'||url.username||url.password||url.hash||url.search||
     !/^\/pay\/c-[0-9a-f-]{36}$/i.test(url.pathname))throw Error('Invalid SumUp link');
  paymentUrl=url.href;
 }
 const footers=new Set(['Les Buttes Holiday Cottages',
  'Please reply to the email you received if you need assistance.']);
 const ownerFields=type==='owner_request'?lines.filter(x=>/^(?:Guest|Guests|Email|Telephone): /.test(x)):[];
 const detail=new Set([stay,reference,amount,candidate,...ownerFields,...footers]);
 const content=lines.filter(x=>!detail.has(x)).map(textRow).join('');
 const [cottage,isoDates]=stay.split(' | ');
 const [arrival,departure]=isoDates.split(' to ');
 const formatDate=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
 const dates=formatDate(arrival)+' – '+formatDate(departure);
 const status=type==='requested'?'REQUEST RECEIVED':
  type==='approval_payment'?'PAYMENT REQUIRED':
  type==='confirmed'?'BOOKING CONFIRMED':
  type==='cancelled'?'BOOKING CANCELLED':
  type==='owner_request'?'OWNER ACTION REQUIRED':'BOOKING UPDATE';
 const ownerButton=type==='owner_request'?
  '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;"><tr><td bgcolor="#194c3d" style="border-radius:4px;"><a href="https://lesbuttes.ozanne-family.com" style="display:inline-block;padding:15px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Review booking request</a></td></tr></table>':'';
 const ownerDetails=ownerFields.length?
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #e6e3d8;background:#fffdf8;"><tr><td style="padding:17px 21px;">'+
  '<p style="margin:0 0 12px;color:#194c3d;font-size:11px;letter-spacing:1.1px;font-weight:700;">GUEST DETAILS</p>'+
  ownerFields.map(x=>'<p style="margin:0 0 7px;color:#33483f;font-size:14px;line-height:1.5;">'+escapeHtml(x)+'</p>').join('')+
  '</td></tr></table>':'';
 const button=paymentUrl?'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;"><tr><td bgcolor="#194c3d" style="border-radius:4px;"><a href="'+escapeHtml(paymentUrl)+'" style="display:inline-block;padding:15px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Pay securely with SumUp</a></td></tr></table><p style="margin:0 0 18px;color:#52685b;font-size:12px;line-height:1.6;">If the button does not work, copy this secure payment link into your browser:<br><a style="color:#194c3d;word-break:break-all;" href="'+escapeHtml(paymentUrl)+'">'+escapeHtml(paymentUrl)+'</a></p>':'';
 const amountHtml=amount?'<p style="margin:15px 0 0;color:#17332a;font-size:19px;font-weight:700;">'+escapeHtml(amount)+'</p>':'';
 return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(titles[type])+'</title></head>'+
 '<body style="margin:0;padding:0;background:#f7f3e9;color:#17332a;font-family:Arial,Helvetica,sans-serif;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9;"><tr><td align="center" style="padding:28px 12px 36px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf8;border:1px solid #e6e3d8;">'+
 '<tr><td style="padding:27px 34px;background:#194c3d;border-top:4px solid #b47b3a;">'+
 '<p style="margin:0 0 7px;color:#e7c58f;font-size:10px;letter-spacing:2.2px;font-weight:700;">GUERNSEY HOLIDAY COTTAGES</p>'+
 '<p style="margin:0;color:#fffdf8;font-size:35px;line-height:1.15;font-family:Georgia,Times New Roman,serif;">Les Buttes</p></td></tr>'+
 '<tr><td style="padding:32px 34px 12px;"><p style="margin:0 0 9px;color:#8d6635;font-size:11px;letter-spacing:1.5px;font-weight:700;">'+escapeHtml(status)+'</p>'+
 '<h1 style="margin:0 0 19px;font-family:Georgia,Times New Roman,serif;font-size:28px;line-height:1.2;font-weight:400;color:#17332a;">'+escapeHtml(titles[type])+'</h1>'+
 content+'</td></tr>'+
 '<tr><td style="padding:8px 34px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7f3e9;border-left:3px solid #b47b3a;"><tr><td style="padding:18px 21px;">'+
 '<p style="margin:0 0 7px;color:#194c3d;font-size:11px;letter-spacing:1.1px;font-weight:700;">YOUR STAY</p>'+
 '<p style="margin:0 0 6px;font-size:20px;font-family:Georgia,Times New Roman,serif;">'+escapeHtml(cottage)+'</p>'+
 '<p style="margin:0 0 12px;font-size:14px;color:#33483f;">'+escapeHtml(dates)+'</p>'+
 '<p style="margin:0;color:#52685b;font-size:11px;word-break:break-word;">'+escapeHtml(reference)+'</p>'+amountHtml+
 '</td></tr></table>'+ownerDetails+ownerButton+button+'</td></tr>'+
 '<tr><td style="padding:21px 34px;background:#edf0e9;border-top:1px solid #d9e0d6;">'+
 '<p style="margin:0 0 7px;color:#17332a;font-size:13px;font-weight:700;">Les Buttes Holiday Cottages</p>'+
 '<p style="margin:0 0 9px;color:#52685b;font-size:12px;line-height:1.6;">St Pierre du Bois, Guernsey</p>'+
 '<p style="margin:0;color:#52685b;font-size:12px;line-height:1.6;">Questions? Simply reply to this email or visit <a href="https://lesbuttes.com" style="color:#194c3d;">lesbuttes.com</a>.</p>'+
 '</td></tr></table></td></tr></table></body></html>';
}
