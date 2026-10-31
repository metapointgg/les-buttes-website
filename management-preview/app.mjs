import {allowedAction,safeStagingApi,reasonValid,bookingStatus} from './model.mjs';
const $=id=>document.getElementById(id);
const state={api:null,token:null,bookings:[],cursor:null,selected:null,auditCursor:null,role:'viewer'};
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
  const detail=$('detail');detail.replaceChildren();
  for(const [label,value] of [['Reference',booking.id],['Guest',booking.guestName],['Email',booking.guestEmail],
   ['Status',booking.status],['Reservation state',booking.reservationStatus],['Cottages',(booking.units||[]).join(', ')],
   ['Arrival',booking.start],['Departure',booking.end],['Guests',booking.guests],
   ['Quoted price',booking.quote?.totalGBP===undefined?'Not available':'£'+booking.quote.totalGBP],
   ['Hold expires',booking.holdExpiresAt?new Date(booking.holdExpiresAt*1000).toLocaleString('en-GB'):'Not applicable']])
   row(detail,label,value??'—');
  $('owner-actions').hidden=false;
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
 state.api=api;state.token=token;$('token').value='';loadBookings();
});
$('disconnect').addEventListener('click',()=>{
 state.api=null;state.token=null;state.bookings=[];state.cursor=null;state.selected=null;
 $('bookings').replaceChildren();$('detail').replaceChildren();$('audit').replaceChildren();
 $('owner-actions').hidden=true;$('more').hidden=true;$('more-audit').hidden=true;message('Disconnected.');
});
$('more').addEventListener('click',()=>loadBookings(true));
$('more-audit').addEventListener('click',()=>loadAudit(true));
$('decline').addEventListener('click',()=>performAction('decline'));
$('cancel').addEventListener('click',()=>performAction('cancel'));
