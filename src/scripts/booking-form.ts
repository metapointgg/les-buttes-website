import {previewBookingQuote} from '../lib/booking-preview';
type BookingMessages = {
  invalid:string; over:string; checking:string; sending:string; error:string; priceLabel:string;
  ready:string; unavailable:string; success:string;
};
type CheckResponse={available?:boolean;reason?:string;quote?:{currency:string;totalGBP:string}};
const DAY=86400000;
function dateDays(start:string,end:string):number{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return NaN;
  const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z');
  if(!Number.isFinite(a)||!Number.isFinite(b)||new Date(a).toISOString().slice(0,10)!==start||new Date(b).toISOString().slice(0,10)!==end)return NaN;
  return (b-a)/DAY;
}
const caps:Record<string,number>={geranium:4,honeysuckle:6,both:10};
document.querySelectorAll<HTMLFormElement>('[data-booking-form]').forEach(form=>{
  if(form.dataset.mode==='preview'){
    const c:Record<string,string>=JSON.parse(form.dataset.previewMessages??'{}');
    const get=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement;
    const unitInput=get('unit') as HTMLSelectElement;
    const startInput=get('start') as HTMLInputElement;
    const endInput=get('end') as HTMLInputElement;
    const guestsInput=get('guests') as HTMLInputElement;
    const output=form.parentElement?.querySelector<HTMLElement>('[data-preview-result]');
    const feedback=form.querySelector<HTMLElement>('[data-feedback]');
    const button=form.querySelector<HTMLButtonElement>('[data-preview-quote]');
    const label=(selector:string)=>output?.querySelector<HTMLElement>(selector);
    const money=(value:number)=>new Intl.NumberFormat(document.documentElement.lang||'en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(value);
    const reset=()=>{
      if(output)output.hidden=true;
      if(feedback)feedback.textContent=c.defaultPrompt||'';
    };
    const updateCapacity=()=>{
      const capacity={geranium:4,honeysuckle:6,both:10}[unitInput.value as 'geranium'|'honeysuckle'|'both']||4;
      guestsInput.max=String(capacity);
      if(Number(guestsInput.value)>capacity)guestsInput.value=String(capacity);
    };
    unitInput.addEventListener('change',()=>{updateCapacity();reset();});
    for(const input of [startInput,endInput,guestsInput])input.addEventListener('change',reset);
    startInput.addEventListener('change',()=>{
      if(startInput.value&&endInput.value&&endInput.value<=startInput.value)endInput.value='';
      if(startInput.value){
        const next=new Date(Date.parse(startInput.value+'T00:00:00Z')+DAY).toISOString().slice(0,10);
        endInput.min=next;
      }
    });
    form.addEventListener('submit',event=>event.preventDefault());
    button?.addEventListener('click',()=>{
      try{
        const unit=unitInput.value as 'geranium'|'honeysuckle'|'both';
        const quote=previewBookingQuote(unit,startInput.value,endInput.value,Number(guestsInput.value));
        const rows=label('[data-preview-cottages]');
        if(rows){
          rows.replaceChildren();
          for(const item of quote.units){
            const li=document.createElement('li');
            const name=document.createElement('span'),amount=document.createElement('span');
            name.textContent=item.unit==='geranium'?'Geranium': 'Honeysuckle';
            amount.textContent=money(item.indicativeDirectGBP);
            li.append(name,amount);
            rows.appendChild(li);
          }
        }
        const dateLabel=label('[data-preview-dates]');
        if(dateLabel)dateLabel.textContent=quote.start+' – '+quote.end+' · '+quote.nights+' '+(c.nights||'nights');
        const airbnb=label('[data-preview-airbnb]');
        const direct=label('[data-preview-direct]');
        const savings=label('[data-preview-saving]');
        const minimum=label('[data-preview-minimum]');
        if(airbnb)airbnb.textContent=money(quote.airbnbTotalGBP);
        if(direct)direct.textContent=money(quote.indicativeDirectTotalGBP);
        if(savings)savings.textContent=money(quote.guestSavingGBP)+' ('+quote.guestSavingPercent+'%)';
        if(minimum)minimum.textContent=(c.minimum||'Draft minimum')+': '+quote.draftMinimumNights+' '+(c.nights||'nights')+'. '+(quote.meetsDraftMinimum?c.minimumMet:c.minimumNotMet);
        if(output)output.hidden=false;
        if(feedback)feedback.textContent='';
      }catch(error){
        if(output)output.hidden=true;
        const code=error instanceof Error?error.message:'unavailableQuote';
        if(feedback)feedback.textContent=c[code]||c.unavailableQuote||'Unable to estimate';
      }
    });
    updateCapacity();
    return;
  }
  const url=form.dataset.api??'';
  if(!url)return;
  const messages:BookingMessages=JSON.parse(form.dataset.messages??'{}');
  const feedback=form.querySelector<HTMLElement>('[data-feedback]');
  const quoteBox=form.querySelector<HTMLElement>('[data-quote]');
  const quoteValue=form.querySelector<HTMLElement>('[data-quote-value]');
  const hideQuote=()=>{if(quoteBox)quoteBox.hidden=true;};
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
    const f=fields(),parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Guernsey',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const p=Object.fromEntries(parts.filter(part=>['year','month','day'].includes(part.type)).map(part=>[part.type,part.value]));
    const localToday=p.year+'-'+p.month+'-'+p.day;
    const nights=dateDays(f.start,f.end);
    if(!Number.isInteger(nights)||nights<1||nights>27||f.start<localToday){notice(messages.invalid);return false;}
    if(!Number.isInteger(f.guests)||f.guests<1||f.guests>(caps[f.unit]??0)){notice(messages.over);return false;}
    return true;
  };
  async function checkAvailability(){
    if(busy||!validate())return false;
    busy=true;hideQuote();checkButton && (checkButton.disabled=true);notice(messages.checking);
    try{
      const f=fields();
      const params=new URLSearchParams({unit:f.unit,start:f.start,end:f.end,guests:String(f.guests)});
      const response=await fetch(url+'/availability?'+params,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)throw Error('Availability check failed');
      const result:CheckResponse=await response.json();
      if(result.available===true&&result.quote?.currency==='GBP'&&Number.isFinite(Number(result.quote.totalGBP))){
        approvedKey=key();
        if(quoteValue)quoteValue.textContent=messages.priceLabel+': '+new Intl.NumberFormat(document.documentElement.lang||'en-GB',{style:'currency',currency:'GBP'}).format(Number(result.quote.totalGBP));
        if(quoteBox)quoteBox.hidden=false;
        notice(messages.ready);return true;
      }
      approvedKey='';notice(messages.unavailable);return false;
    }catch{
      approvedKey='';notice(messages.error);return false;
    }finally{busy=false;checkButton && (checkButton.disabled=false);}
  }
  checkButton?.addEventListener('click',()=>{void checkAvailability();});
  form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name=unit],[name=start],[name=end],[name=guests]').forEach(el=>el.addEventListener('change',()=>{approvedKey='';hideQuote();notice('');}));
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
      form.reset();approvedKey='';hideQuote();turnstile?.reset();notice(messages.success);
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
    if(!render()){
      // Cloudflare's async script can finish after window.load: retry briefly, then fail closed.
      let attempts=0;
      const timer=window.setInterval(()=>{
        if(render()||++attempts>=60)window.clearInterval(timer);
      },150);
    }
  }
});
