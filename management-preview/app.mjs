import {allowedAction,safeStagingApi,reasonValid,bookingStatus} from './model.mjs';
import {hostedManagement,isHostedManagement,createHostedAuthorisationUrl,completeHostedSignIn,hostedSignOutUrl} from './hosted-auth.mjs';
const $=id=>document.getElementById(id);
const state={api:null,token:null,bookings:[],cursor:null,selected:null,selectedBooking:null,auditCursor:null,role:'viewer'};
const message=(text,error=false)=>{$('message').textContent=text;$('message').className=error?'error':'';};
const node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=String(text??'');if(className)el.className=className;return el;};
const row=(container,label,value)=>{const el=node('div','','row');el.append(node('span',label),node('strong',value));container.append(el);};
async function request(path,{method='GET',body}={}){
 const response=await fetch(state.api+path,{method,headers:{Authorization:'Bearer '+state.token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'Management API returned '+response.status);
 return result;
}
function renderList(){
 $('bookings').replaceChildren();
 for(const booking of state.bookings){
  const button=node('button',`${booking.guestName||'Guest'} — ${bookingStatus(booking)} — ${booking.start||''}`,'booking');
  button.setAttribute('aria-current',String(state.selected===booking.id));
  button.addEventListener('click',()=>selectBooking(booking.id));
  $('bookings').append(button);
 }
 if(!state.bookings.length)$('bookings').append(node('p','No booking requests found.'));
 $('more').hidden=!state.cursor;
}
async function loadBookings(more=false){
 try{
  message('Loading booking requests…');
  const result=await request('/admin/bookings?limit=30'+(more&&state.cursor?'&cursor='+encodeURIComponent(state.cursor):''));
  state.bookings=more?[...state.bookings,...(result.items||[])]:result.items||[];
  state.cursor=result.nextCursor;
  renderList();message('Booking requests loaded.');
 }catch(e){message(e.message,true);}
}
async function selectBooking(id){
 try{
  state.selected=id;renderList();
  const booking=await request('/admin/bookings/'+encodeURIComponent(id));
  state.selectedBooking=booking;
  const detail=$('detail');detail.replaceChildren();
  for(const [label,value] of [['Reference',booking.id],['Guest',booking.guestName],['Email',booking.guestEmail],
   ['Status',booking.status],['Reservation state',booking.reservationStatus],['Cottages',(booking.units||[]).join(', ')],
   ['Arrival',booking.start],['Departure',booking.end],['Guests',booking.guests],
   ['Quoted price',booking.quote?.totalGBP===undefined?'Not available':'£'+booking.quote.totalGBP],
   ['Hold expires',booking.holdExpiresAt?new Date(booking.holdExpiresAt*1000).toLocaleString('en-GB'):'Not applicable']])
   row(detail,label,value??'—');
  $('owner-actions').hidden=state.role!=='owner';
  $('approve-consent').checked=false;
  $('approve').disabled=!allowedAction(booking,'approve')||state.role!=='owner';
  $('decline').disabled=!allowedAction(booking,'decline');
  $('cancel').disabled=!allowedAction(booking,'cancel');
  $('reason').value='';
  state.auditCursor=null;
  $('audit').replaceChildren();
  await loadAudit(false);
 }catch(e){message(e.message,true);}
}
async function loadAudit(more){
 try{
  const url='/admin/bookings/'+encodeURIComponent(state.selected)+'/audit?limit=20'+
    (more&&state.auditCursor?'&cursor='+encodeURIComponent(state.auditCursor):'');
  const result=await request(url);
  if(!more)$('audit').replaceChildren();
  for(const record of result.items||[]){
   const entry=node('div','','audit-entry');
   entry.append(node('strong',record.action||'Change'),node('p',`${record.recordedAt||''} — ${record.actor||'Unknown owner'}`),
     node('small',`${record.from||''} → ${record.to||''}`));
   $('audit').append(entry);
  }
  state.auditCursor=result.nextCursor;
  $('more-audit').hidden=!state.auditCursor;
  if(!$('audit').children.length)$('audit').append(node('p','No management actions recorded.'));
 }catch(e){message(e.message,true);}
}
async function performAction(action){
 const reason=$('reason').value;
 if(!reasonValid(reason)){message('Provide a reason of at least five characters.',true);return;}
 if(!window.confirm(`Are you sure you want to ${action} this booking? This cannot be undone.`))return;
 for(const key of ['decline','cancel'])$(key).disabled=true;
 try{
  await request('/admin/bookings/'+encodeURIComponent(state.selected)+'/actions/'+action,{method:'POST',body:{reason}});
  message('Booking '+action+' action completed.');await loadBookings();await selectBooking(state.selected);
 }catch(e){message(e.message,true);await selectBooking(state.selected);}
}
$('connect').addEventListener('click',()=>{
 const api=safeStagingApi($('api').value.trim());
 const token=$('token').value.trim();
 if(!api||!token){message('Enter a valid eu-west-2 staging API URL and access token.',true);return;}
 state.api=api;state.token=token;
 try{
  const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const groups=claims['cognito:groups']||[];
  state.role=Array.isArray(groups)&&groups.includes('lesbuttes-owner')?'owner':'viewer';
 }catch{state.role='viewer';}
 $('configuration-panel').hidden=state.role!=='owner';$('token').value='';loadBookings();
});
$('disconnect').addEventListener('click',()=>{
 state.api=null;state.token=null;state.bookings=[];state.cursor=null;state.selected=null;state.selectedBooking=null;state.role='viewer';
 $('bookings').replaceChildren();$('detail').replaceChildren();$('audit').replaceChildren();
 $('owner-actions').hidden=true;$('configuration-panel').hidden=true;$('more').hidden=true;$('more-audit').hidden=true;message('Disconnected.');
});
$('more').addEventListener('click',()=>loadBookings(true));
$('more-audit').addEventListener('click',()=>loadAudit(true));
$('approve').addEventListener('click',async()=>{
 if(state.role!=='owner'||!state.selected||!$('approve-consent').checked){
  message('Explicit approval of the published quotation is required.',true);return;
 }
 if(!window.confirm('Approve this booking at its published quotation? This reserves the dates pending payment, but does not send a payment link.'))return;
 $('approve').disabled=true;
 try{
  await request('/admin/bookings/'+encodeURIComponent(state.selected)+'/actions/approve',
   {method:'POST',body:{approved:true,usePublishedQuote:true}});
  message('Booking approved at its published quotation. Checkout registration remains a separate owner action.');
  await loadBookings();await selectBooking(state.selected);
 }catch(e){message(e.message,true);await selectBooking(state.selected);}
});
$('approve-consent').addEventListener('change',()=>{
 $('approve').disabled=!$('approve-consent').checked||!state.selected||
  !allowedAction(state.selectedBooking,'approve')||state.role!=='owner';
});
$('decline').addEventListener('click',()=>performAction('decline'));
$('cancel').addEventListener('click',()=>performAction('cancel'));

const configPath=()=>'/admin/config/'+$('config-kind').value+'/'+$('config-unit').value;
let currentConfigVersion=null;
$('config-load').addEventListener('click',async()=>{
 try{
  const record=await request(configPath());
  currentConfigVersion=record?.version??null;
  $('config-version').textContent='Current version: '+(currentConfigVersion||'Not published');
  $('config-value').value=JSON.stringify(record?.value??{},null,2);
  $('config-approve').checked=false;
 }catch(e){message(e.message,true);}
});
$('config-history').addEventListener('click',async()=>{
 try{
  const versions=await request(configPath()+'/versions');
  $('config-versions').replaceChildren();
  for(const record of versions){
   const entry=node('div','','audit-entry');
   entry.append(node('strong',record.version),node('p','Published by '+(record.approvedBy||'owner')));
   const restore=node('button','Prepare rollback','secondary');
   restore.addEventListener('click',()=>{
    $('config-value').value=JSON.stringify(record.value,null,2);
    $('config-approve').checked=false;
    message('Historical version loaded into editor. Review and publish as a new version.');
   });
   entry.append(restore);$('config-versions').append(entry);
  }
 }catch(e){message(e.message,true);}
});
$('config-publish').addEventListener('click',async()=>{
 if(!$('config-approve').checked){message('Explicit owner approval is required.',true);return;}
 let value;
 try{value=JSON.parse($('config-value').value);}catch{message('Configuration must be valid JSON.',true);return;}
 if(!window.confirm('Publish this configuration to the staging booking master?'))return;
 $('config-publish').disabled=true;
 try{
  const result=await request(configPath()+'/publish',{method:'POST',
    body:{value,expectedVersion:currentConfigVersion,approved:true}});
  currentConfigVersion=result.version;
  $('config-version').textContent='Current version: '+result.version;
  $('config-approve').checked=false;message('Configuration published to staging.');
 }catch(e){message(e.message,true);}
 finally{$('config-publish').disabled=false;}
});


// A separate staging CloudFront page has its own dedicated PKCE client.
 // The existing production operations website and its Cognito client are unchanged.
if(isHostedManagement(location)){
 $('api').value=hostedManagement.api;
 $('api').readOnly=true;
 $('token').closest('label').hidden=true;
 $('connect').hidden=true;
 $('sign-in').hidden=false;
 $('disconnect').textContent='Sign out';
 $('owner-actions').hidden=true;
 $('configuration-panel').hidden=true;
 $('sign-in').addEventListener('click',async()=>{
  try{
   const url=await createHostedAuthorisationUrl({session:sessionStorage,cryptoApi:crypto});
   location.assign(url);
  }catch{message('Unable to start a secure Cognito sign-in.',true);}
 });
 $('disconnect').addEventListener('click',()=>{
  location.assign(hostedSignOutUrl());
 });
 const returnedSearch=location.search;
 if(new URLSearchParams(returnedSearch).has('code')||
    new URLSearchParams(returnedSearch).has('error')){
  // Remove the short-lived authorisation code from browser history immediately.
  history.replaceState(null,'',hostedManagement.path);
  message('Verifying your staging sign-in…');
  void completeHostedSignIn({
   search:returnedSearch,session:sessionStorage,fetchImpl:fetch
  }).then(accessToken=>{
   if(!accessToken){message('Sign in to view staging booking requests.');return;}
   state.api=hostedManagement.api;
   state.token=accessToken;
   state.role='viewer';
   $('sign-in').hidden=true;
   $('owner-actions').hidden=true;
   $('configuration-panel').hidden=true;
   void loadBookings();
  }).catch(()=>message('Sign-in failed or staging viewer access is not authorised. Please try again.',true));
 }else{
  message('Sign in with Cognito to view staging booking requests. No booking changes are enabled.');
 }
}
