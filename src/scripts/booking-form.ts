type BookingMessages = {
  invalid:string; over:string; checking:string; sending:string; error:string;
  ready:string; unavailable:string; success:string;
};
type CheckResponse={available?:boolean;reason?:string};
const DAY=86400000;
function dateDays(start:string,end:string):number{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return NaN;
  const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z');
  if(!Number.isFinite(a)||!Number.isFinite(b)||new Date(a).toISOString().slice(0,10)!==start||new Date(b).toISOString().slice(0,10)!==end)return NaN;
  return (b-a)/DAY;
}
const caps:Record<string,number>={geranium:4,honeysuckle:6,both:10};
document.querySelectorAll<HTMLFormElement>('[data-booking-form]').forEach(form=>{
  const url=form.dataset.api??'';
  if(!url)return;
  const messages:BookingMessages=JSON.parse(form.dataset.messages??'{}');
  const feedback=form.querySelector<HTMLElement>('[data-feedback]');
  const checkButton=form.querySelector<HTMLButtonElement>('[data-check-availability]');
  const submitButton=form.querySelector<HTMLButtonElement>('[data-submit]');
  const fields=()=>({
    unit:(form.elements.namedItem('unit') as HTMLSelectElement).value,
    start:(form.elements.namedItem('start') as HTMLInputElement).value,
    end:(form.elements.namedItem('end') as HTMLInputElement).value,
    guests:Number((form.elements.namedItem('guests') as HTMLInputElement).value)
  });
  const notice=(message:string)=>{if(feedback)feedback.textContent=message;};
  let approvedKey='';
  let busy=false;
  const key=()=>JSON.stringify(fields());
  const validate=()=>{
    const f=fields(),today=new Date(),localToday=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    const nights=dateDays(f.start,f.end);
    if(!Number.isInteger(nights)||nights<1||nights>27||f.start<localToday){notice(messages.invalid);return false;}
    if(!Number.isInteger(f.guests)||f.guests<1||f.guests>(caps[f.unit]??0)){notice(messages.over);return false;}
    return true;
  };
  async function checkAvailability(){
    if(busy||!validate())return false;
    busy=true;checkButton && (checkButton.disabled=true);notice(messages.checking);
    try{
      const f=fields();
      const params=new URLSearchParams({unit:f.unit,start:f.start,end:f.end,guests:String(f.guests)});
      const response=await fetch(url+'/availability?'+params,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)throw Error('Availability check failed');
      const result:CheckResponse=await response.json();
      if(result.available===true){approvedKey=key();notice(messages.ready);return true;}
      approvedKey='';notice(messages.unavailable);return false;
    }catch{
      approvedKey='';notice(messages.error);return false;
    }finally{busy=false;checkButton && (checkButton.disabled=false);}
  }
  checkButton?.addEventListener('click',()=>{void checkAvailability();});
  form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name=unit],[name=start],[name=end],[name=guests]').forEach(el=>el.addEventListener('change',()=>{approvedKey='';notice('');}));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||!form.reportValidity()||!validate())return;
    if(approvedKey!==key()&&!await checkAvailability())return;
    if(busy)return;
    busy=true;submitButton && (submitButton.disabled=true);notice(messages.sending);
    try{
      const f=fields();
      const turnstile=(window as typeof window & {turnstile?:{getResponse:()=>string;reset:()=>void}}).turnstile;
      const token=turnstile?.getResponse()??'';
      if(!token)throw Error('Missing verification');
      const payload={...f,name:(form.elements.namedItem('name') as HTMLInputElement).value.trim(),email:(form.elements.namedItem('email') as HTMLInputElement).value.trim(),notes:(form.elements.namedItem('notes') as HTMLTextAreaElement).value.trim(),consent:(form.elements.namedItem('consent') as HTMLInputElement).checked,website:(form.elements.namedItem('website') as HTMLInputElement).value,turnstileToken:token};
      const response=await fetch(url+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!response.ok)throw Error('Request unsuccessful');
      form.reset();approvedKey='';turnstile?.reset();notice(messages.success);
    }catch{notice(messages.error);}
    finally{busy=false;submitButton && (submitButton.disabled=false);}
  });
  // Render the challenge only when its official script has loaded.
  const captcha=form.querySelector<HTMLElement>('[data-turnstile-slot]');
  const siteKey=form.dataset.siteKey;
  if(captcha&&siteKey){
    const render=()=>{
      const t=(window as typeof window & {turnstile?:{render:(el:HTMLElement,opts:{sitekey:string})=>string}}).turnstile;
      if(t){t.render(captcha,{sitekey:siteKey});return true;}return false;
    };
    if(!render())window.addEventListener('load',()=>{render();},{once:true});
  }
});
