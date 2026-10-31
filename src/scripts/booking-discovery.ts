import {canPickCheckout,clearMasterAvailability,daysForMonth,indicativeSelection,masterCheckedAt,masterConnected,matchingOptions,nightsInRange,plusDays,possibleNight,setMasterAvailability,type CottageChoice,type SearchFilters} from '../lib/booking-discovery';

const widget=document.querySelector<HTMLElement>('[data-discovery]');
if(widget){
  const t:Record<string,string|string[]>=JSON.parse(widget.dataset.copy??'{}');
  const tr=(key:string)=>typeof t[key]==='string'?t[key] as string:key;
  const form=widget.querySelector<HTMLFormElement>('[data-discovery-search]')!;
  const get=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement;
  const arrival=get('arrival') as HTMLInputElement,departure=get('departure') as HTMLInputElement;
  const feedback=widget.querySelector<HTMLElement>('[data-discovery-feedback]')!;
  const optionCards=Array.from(widget.querySelectorAll<HTMLElement>('[data-discovery-option]'));
  const calendarSection=widget.querySelector<HTMLElement>('[data-discovery-availability]')!;
  const calendarGrids=widget.querySelector<HTMLElement>('[data-discovery-calendars]')!;
  const calendarMessage=widget.querySelector<HTMLElement>('[data-calendar-message]')!;
  const summarySection=widget.querySelector<HTMLElement>('[data-discovery-summary]')!;
  const summaryLines=widget.querySelector<HTMLElement>('[data-summary-lines]')!;
  const monthLabel=widget.querySelector<HTMLElement>('[data-current-month]')!;
  const prev=widget.querySelector<HTMLButtonElement>('[data-prev-month]')!;
  const next=widget.querySelector<HTMLButtonElement>('[data-next-month]')!;
  const localPreview=['localhost','127.0.0.1'].includes(window.location.hostname);
  // Guest availability uses a separate public, date-only endpoint; no sign-in.
  // Explicit host allowlist prevents the staging calendar from leaking into production.
  const allowedHosts=(import.meta.env.PUBLIC_BOOKING_STAGING_ALLOWED_HOSTS??'')
    .split(',').map((host:string)=>host.trim().toLowerCase()).filter(Boolean);
  const hostedReadOnlyEnabled=import.meta.env.PUBLIC_BOOKING_STAGING_READ_ONLY_ENABLED==='true' &&
    allowedHosts.includes(window.location.hostname.toLowerCase()) && !localPreview;
  const availabilityUrl=localPreview?'http://127.0.0.1:4328/availability':
    hostedReadOnlyEnabled?(import.meta.env.PUBLIC_BOOKING_AVAILABILITY_URL??null):null;
  let fetchSequence=0;
  const lang=widget.dataset.locale==='fr'?'fr-FR':widget.dataset.locale==='nl'?'nl-NL':'en-GB';
  const money=(v:number)=>new Intl.NumberFormat(lang,{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(v);
  const readable=(date:string,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(lang,{...opts,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  const rangeLabel=(start:string,end:string)=>new Intl.DateTimeFormat(lang,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).formatRange(new Date(start+'T00:00:00Z'),new Date(end+'T00:00:00Z'));
  const formatDay=(date:string)=>readable(date,{weekday:'long',day:'numeric',month:'long'});
  let choice:CottageChoice|null=null,month='2027-03',pendingStart:string|null=null;
  let filters:SearchFilters={adults:2,children:0,bedrooms:0,choice:'any'};
  let activeStep=1;
  const screens=Array.from(widget.querySelectorAll<HTMLElement>('[data-booking-step]'));
  const indicators=Array.from(widget.querySelectorAll<HTMLElement>('[data-journey-indicator]'));
  const reviewNext=widget.querySelector<HTMLButtonElement>('[data-continue-review]')!;
  const detailsForm=widget.querySelector<HTMLFormElement>('[data-preview-guest-details]')!;
  // A server-authoritative quote is mandatory before advancing from review.
  // The existing staging read-only master never authorises a request or payment.
  const bookingApi=(import.meta.env.PUBLIC_BOOKING_REQUEST_API_URL??'').trim().replace(/\/$/,'');
  const liveQuoteEnabled=import.meta.env.PUBLIC_BOOKING_AUTHORITATIVE_QUOTES_ENABLED==='true'&&
    Boolean(bookingApi)&&!localPreview;
  let authoritativeQuote:{key:string;totalGBP:string}|null=null;
  const quoteKey=()=>JSON.stringify([choice,arrival.value,departure.value,filters.adults+filters.children]);
  async function checkAuthoritativeQuote(){
    authoritativeQuote=null;
    if(!liveQuoteEnabled||!choice||!masterConnected()||!weekly(arrival.value,departure.value))return false;
    const key=quoteKey();
    const params=new URLSearchParams({unit:choice,start:arrival.value,end:departure.value,
      guests:String(filters.adults+filters.children)});
    try{
      const response=await fetch(bookingApi+'/availability?'+params,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)return false;
      const result=await response.json() as {available?:boolean;quote?:{currency?:string;totalGBP?:string}};
      if(result.available!==true||result.quote?.currency!=='GBP'||
         !/^\\d+(?:\\.\\d{1,2})?$/.test(result.quote.totalGBP??''))return false;
      if(key!==quoteKey())return false;
      authoritativeQuote={key,totalGBP:result.quote.totalGBP!};
      return true;
    }catch{return false;}
  }

  const setStep=(step:number)=>{
    activeStep=step;
    for(const screen of screens)screen.hidden=Number(screen.dataset.bookingStep)!==step;
    for(const indicator of indicators){
      const index=Number(indicator.dataset.journeyIndicator);
      if(index===step)indicator.setAttribute('aria-current','step');
      else indicator.removeAttribute('aria-current');
      indicator.classList.toggle('is-complete',index<step);
    }
    const heading=screens.find(x=>Number(x.dataset.bookingStep)===step)?.querySelector<HTMLElement>('h2');
    // Keep browser scrolling predictable when moving between the four screens.
    widget.scrollIntoView({behavior:'smooth',block:'start'});
    heading?.setAttribute('tabindex','-1');
    heading?.focus({preventScroll:true});
  };
  const saturday=(d:string)=>new Date(d+'T00:00:00Z').getUTCDay()===6;
  const weekly=(start:string,end:string)=>{try{const n=nightsInRange(start,end).length;return saturday(start)&&saturday(end)&&n%7===0;}catch{return false;}};
  const getQuote=()=>{
    if(!masterConnected()||!choice||!arrival.value||!departure.value||!weekly(arrival.value,departure.value))return null;
    try{return indicativeSelection(choice,arrival.value,departure.value,filters);}
    catch{return null;}
  };
  const updateNext=()=>{
    const q=getQuote();
    reviewNext.disabled=!masterConnected()||!q||!q.meetsDraftMinimum;
    reviewNext.setAttribute('aria-disabled',String(!masterConnected()));
    const note=widget.querySelector<HTMLElement>('[data-selection-feedback]');
    if(note)note.textContent=!masterConnected()?tr('masterOffline'):
      !q?tr('datesNeeded'):!q.meetsDraftMinimum?tr('tooShort'):tr('minimumOkay');
    const searchSummary=widget.querySelector<HTMLElement>('[data-journey-selection]');
    if(searchSummary)searchSummary.textContent=filters.adults+' '+tr('adults')+' · '+filters.children+' '+tr('children')+
      (arrival.value&&departure.value?' · '+rangeLabel(arrival.value,departure.value):'');
  };

  const monthShift=(m:string,n:number)=>{
    const [year,mo]=m.split('-').map(Number);
    return new Date(Date.UTC(year,mo-1+n,1)).toISOString().slice(0,7);
  };
  const fill=(selector:string,value:string)=>{
    const el=widget.querySelector<HTMLElement>(selector);
    if(el)el.textContent=value;
  };
  async function refreshMaster(){
    const request=++fetchSequence;
    // Never put staging credentials in a web bundle or contact users' local ports on hosted sites.
    if(!availabilityUrl){clearMasterAvailability();return false;}
    try{
      const response=await fetch(availabilityUrl,{
        method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000)
      });
      if(!response.ok)throw Error('masterUnavailable');
      const data:unknown=await response.json();
      if(request!==fetchSequence)return false;
      setMasterAvailability(data);
      fill('[data-master-status]',tr('liveMaster')+' '+new Intl.DateTimeFormat(lang,{
        hour:'2-digit',minute:'2-digit',timeZone:'Europe/Guernsey'
      }).format(new Date(masterCheckedAt()!)));
      return true;
    }catch{
      if(request===fetchSequence){
        clearMasterAvailability();
        fill('[data-master-status]',tr('masterOffline'));
      }
      return false;
    }
  }
  function newFilters():SearchFilters{
    return {adults:Number(get('adults').value),children:Number(get('children').value),
      bedrooms:Number(get('bedrooms').value),choice:'any'};
  }
  function updateResults(){
    const dates=[arrival.value||undefined,departure.value||undefined] as const;
    const guests=filters.adults+filters.children;
    // Offer both only where no single cottage can accommodate the party.
    const candidates=guests>6?[...matchingOptions({...filters,choice:'both'},...dates)]:matchingOptions({...filters,choice:'any'},...dates);
    const haveValidParty=filters.adults>=1&&filters.children>=0&&filters.adults+filters.children<=10&&
      Number.isInteger(filters.adults)&&Number.isInteger(filters.children);
    for(const card of optionCards){
      const unit=card.dataset.discoveryOption as CottageChoice;
      const match=candidates.find(c=>c.unit===unit);
      card.hidden=!match;
      card.classList.toggle('is-selected',unit===choice);
      if(!match)continue;
      const status=card.querySelector<HTMLElement>('[data-discovery-status]');
      if(status)status.textContent=match.listedAs==='occupied'?tr('occupied'):
        match.listedAs==='possible'?tr('possible'):tr('unchecked');
      const button=card.querySelector<HTMLButtonElement>('[data-select-option]');
      if(button){
        button.textContent=unit===choice?tr('choice'):tr('pick');
        button.setAttribute('aria-pressed',String(unit===choice));
      }
    }
    if(!candidates.length){
      feedback.textContent=!haveValidParty?tr('guestsInvalid'):tr('none');
      choice=null;calendarSection.hidden=true;summarySection.hidden=true;
      reviewNext.disabled=true;
      return;
    }
    if(!choice||!candidates.some(c=>c.unit===choice)){
      choice=candidates.find(c=>c.listedAs!=='occupied')?.unit??candidates[0].unit;
      pendingStart=null;
    }
    filters.choice=choice==='both'?'both':'any';
    feedback.textContent=!masterConnected()?tr('masterOffline'):
      arrival.value&&departure.value&&candidates.every(c=>c.listedAs==='occupied')?tr('blocked'):tr('liveDisclaimer');
    calendarSection.hidden=false;
    renderCalendars();
    renderSummary();
    for(const card of optionCards){
      const unit=card.dataset.discoveryOption as CottageChoice;
      card.classList.toggle('is-selected',unit===choice);
      const button=card.querySelector<HTMLButtonElement>('[data-select-option]');
      if(button&&(!card.hidden)){button.textContent=unit===choice?tr('choice'):tr('pick');button.setAttribute('aria-pressed',String(unit===choice));}
    }
    updateNext();
  }
  function renderSummary(){
    summarySection.hidden=true;
    if(!masterConnected()||!choice||!arrival.value||!departure.value)return;
    try{
      const quote=indicativeSelection(choice,arrival.value,departure.value,filters);
      summaryLines.replaceChildren();
      for(const item of quote.units){
        const row=document.createElement('div');row.className='summary-line';
        const name=document.createElement('span'),price=document.createElement('strong');
        name.textContent=item.unit==='geranium'?'Geranium':'Honeysuckle';
        price.textContent=money(item.indicativeDirectGBP);
        row.append(name,price);summaryLines.appendChild(row);
      }
      fill('[data-summary-stay]',rangeLabel(quote.start,quote.end)+' · '+quote.nights+' '+tr('nightWord')+' · '+(quote.adults+quote.children)+' '+tr('guestWord'));
      fill('[data-summary-airbnb]',money(quote.airbnbTotalGBP));
      fill('[data-summary-direct]',money(quote.indicativeDirectTotalGBP));
      fill('[data-summary-saving]',money(quote.guestSavingGBP)+' ('+quote.guestSavingPercent+'%)');
      fill('[data-summary-minimum]',tr('minimum')+': '+quote.draftMinimumNights+' '+tr('nightWord')+'. '+(quote.meetsDraftMinimum?tr('minimumOkay'):tr('tooShort')));
      summarySection.hidden=false;
      if(!quote.meetsDraftMinimum)calendarMessage.textContent=tr('tooShort');
    }catch(error){
      if(error instanceof Error&&error.message==='occupied')calendarMessage.textContent=tr('blocked');
    }
  }
  function renderCalendars(){
    if(!choice)return;
    calendarGrids.replaceChildren();
    calendarGrids.classList.toggle('two-cottages',false);
    const names=choice==='both'?(['geranium'] as const):([choice] as const);
    const shownMonths=[month,monthShift(month,1)];
    monthLabel.textContent=shownMonths.map(m=>readable(m+'-01',{month:'short',year:'numeric'})).join(' – ');
    prev.disabled=month<='2027-03';next.disabled=month>='2027-09';
    const weekdays=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(lang,{weekday:'narrow',timeZone:'UTC'}).format(new Date(Date.UTC(2027,2,22+i))));
    for(const unit of names){
      const section=document.createElement('div');section.className='calendar-cottage';
      const title=document.createElement('h3');title.className='calendar-cottage-title';
      title.textContent=choice==='both'?'Geranium + Honeysuckle — shared availability':unit==='geranium'?'Geranium Cottage':'Honeysuckle Cottage';
      section.appendChild(title);
      const twoMonths=document.createElement('div');twoMonths.className='calendar-two-months';
      for(const m of shownMonths){
        const panel=document.createElement('div');panel.className='calendar-month';
        const head=document.createElement('h4');head.className='calendar-month-label';
        head.textContent=readable(m+'-01',{month:'long',year:'numeric'});
        panel.appendChild(head);
        const week=document.createElement('div');week.className='calendar-weekdays';
        for(const wd of weekdays){const el=document.createElement('span');el.textContent=wd;week.appendChild(el);}
        panel.appendChild(week);
        const grid=document.createElement('div');grid.className='calendar-days';
        const first=m+'-01',pad=(new Date(first+'T00:00:00Z').getUTCDay()+6)%7;
        for(let i=0;i<pad;i++){const blank=document.createElement('span');blank.className='calendar-empty';grid.appendChild(blank);}
        for(const d of daysForMonth(unit,m)){
          if(choice==='both'&&d.status==='possible'&&!possibleNight('both',d.date))d.status='occupied';
          const date=d.date;
          const between=!!arrival.value&&!!departure.value&&date>arrival.value&&date<departure.value;
          const markedStart=date===(pendingStart||arrival.value);
          const markedEnd=!!departure.value&&date===departure.value;
          const checkoutAllowed=!!pendingStart&&pendingStart<date&&weekly(pendingStart,date)&&canPickCheckout(choice,pendingStart,date);
          const canStart=saturday(date)&&possibleNight(choice,date);
          const disabled=!canStart&&!checkoutAllowed;
          const button=document.createElement('button');button.type='button';
          button.disabled=disabled;
          button.className=[
            d.status==='occupied'?'is-blocked':d.status==='closed'?'is-closed':d.status==='unknown'?'is-unknown':'',
            between?'is-between':'',markedStart?'is-checkin':'',markedEnd?'is-checkout':''
          ].filter(Boolean).join(' ');
          button.title=formatDay(date)+': '+(d.status==='occupied'?tr('dateBlocked'):
            d.status==='closed'?tr('closed'):d.status==='unknown'?tr('masterOffline'):tr('possibleDate'));
          button.setAttribute('aria-label',button.title+(d.rateGBP?' · '+money(d.rateGBP):''));
          button.setAttribute('aria-pressed',String(markedStart||markedEnd));
          const num=document.createElement('span');num.className='calendar-day';
          num.textContent=String(Number(date.slice(-2)));
          button.append(num);
          if(!disabled)button.addEventListener('click',()=>{void selectDate(date);});
          grid.appendChild(button);
        }
        panel.appendChild(grid);twoMonths.appendChild(panel);
      }
      section.appendChild(twoMonths);calendarGrids.appendChild(section);
    }
  }
  async function selectDate(date:string){
    if(!await refreshMaster()){calendarMessage.textContent=tr('masterOffline');updateResults();return;}
    if(!choice)return;
    // One click selects arrival; second click selects checkout (excluded from occupied nights).
    if(!pendingStart||date<=pendingStart||!weekly(pendingStart,date)||!canPickCheckout(choice,pendingStart,date)){
      if(!possibleNight(choice,date)){
        calendarMessage.textContent=tr('different');return;
      }
      pendingStart=date;arrival.value=date;departure.value='';
      calendarMessage.textContent=tr('selectStart');
    }else{
      arrival.value=pendingStart;departure.value=date;
      pendingStart=null;calendarMessage.textContent='';
    }
    updateResults();
  }
  async function search(advance=false){
    await refreshMaster();
    filters=newFilters();
    pendingStart=null;
    if(!Number.isInteger(filters.adults)||filters.adults<1||
       !Number.isInteger(filters.children)||filters.children<0||
       filters.adults+filters.children>10){
      feedback.textContent=tr('guestsInvalid');return;
    }
    if(Boolean(arrival.value)!==Boolean(departure.value)){
      // Date-only search is allowed through the calendar: use arrival as the first click.
      if(arrival.value&&!departure.value){
        pendingStart=arrival.value;
        month=arrival.value.slice(0,7);
      }else{feedback.textContent=tr('invalid');return;}
    }else if(arrival.value&&departure.value){
      if(!weekly(arrival.value,departure.value)){feedback.textContent='Please choose Saturday-to-Saturday dates (7, 14 or 21 nights).';return;}
      try{nightsInRange(arrival.value,departure.value);}
      catch{feedback.textContent=tr('invalid');summarySection.hidden=true;return;}
    }
    if(arrival.value&&(!saturday(arrival.value)||departure.value&&!saturday(departure.value))){feedback.textContent='Check-in and checkout must both be Saturdays.';return;}
    if(arrival.value)month=arrival.value.slice(0,7);
    updateResults();
    if(advance&&matchingOptions({...filters,choice:(filters.adults+filters.children>6?'both':'any')}).length)setStep(2);
  }
  form.addEventListener('submit',event=>{event.preventDefault();void search(true);});
  for(const card of optionCards){
    card.querySelector<HTMLButtonElement>('[data-select-option]')?.addEventListener('click',()=>{
      choice=card.dataset.discoveryOption as CottageChoice;
      filters.choice=choice==='both'?'both':'any';
      pendingStart=null;calendarMessage.textContent='';
      updateResults();
      calendarSection.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
  // Month navigation must never wait for a network round-trip.
  prev.addEventListener('click',()=>{month=monthShift(month,-1);updateResults();});
  next.addEventListener('click',()=>{month=monthShift(month,1);updateResults();});
  const onClick=(selector:string,callback:()=>void|Promise<void>)=>
    widget.querySelector<HTMLButtonElement>(selector)?.addEventListener('click',()=>{void callback();});
  widget.querySelectorAll<HTMLButtonElement>('[data-back-to-filter]').forEach(button=>
    button.addEventListener('click',()=>setStep(1)));
  onClick('[data-back-to-cottages]',()=>setStep(2));
  onClick('[data-back-to-review]',()=>setStep(3));
  onClick('[data-continue-review]',async()=>{
    if(!await refreshMaster()){
      updateResults();
      const note=widget.querySelector<HTMLElement>('[data-selection-feedback]');
      if(note){note.textContent=tr('masterOffline');note.scrollIntoView({behavior:'smooth',block:'center'});}
      return;
    }
    updateResults();
    const quote=getQuote();
    if(!quote||!quote.meetsDraftMinimum)return;
    if(liveQuoteEnabled&&!await checkAuthoritativeQuote()){
      feedback.textContent='An authoritative quote is unavailable. Please try again later.';
      return;
    }
    setStep(3);
  });
  onClick('[data-continue-details]',async()=>{
    if(!await refreshMaster()){updateResults();setStep(2);return;}
    updateResults();
    const q=getQuote();
    if(!q||!q.meetsDraftMinimum){setStep(2);return;}
    if(liveQuoteEnabled&&!await checkAuthoritativeQuote()){
      feedback.textContent='An authoritative quote is unavailable. Please try again later.';
      setStep(2);return;
    }
    fill('[data-details-cottage]',q.units.map(item=>item.unit==='geranium'?'Geranium':'Honeysuckle').join(' + '));
    fill('[data-details-stay]',rangeLabel(q.start,q.end)+' · '+q.nights+' '+tr('nightWord'));
    fill('[data-details-guests]',String(q.adults+q.children));
    fill('[data-details-price]',liveQuoteEnabled&&authoritativeQuote?.key===quoteKey()?money(Number(authoritativeQuote.totalGBP)):money(q.indicativeDirectTotalGBP));
    setStep(4);
  });
  // Preview details never leave the browser: no POST/fetch, booking request, session
  // storage, analytics event, payment handler or confirmation exists in this step.
  // The draft has no submission endpoint; validation is for local preview feedback only.
  const firstNameField=detailsForm.elements.namedItem('firstName') as HTMLInputElement;
  const lastNameField=detailsForm.elements.namedItem('lastName') as HTMLInputElement;
  const emailField=detailsForm.elements.namedItem('email') as HTMLInputElement;
  const phoneField=detailsForm.elements.namedItem('telephone') as HTMLInputElement;
  const consentField=detailsForm.elements.namedItem('consent') as HTMLInputElement;
  const validation=widget.querySelector<HTMLElement>('[data-details-validation]');
  function validateContact(){
    const nameValid=firstNameField.value.trim().length>0&&lastNameField.value.trim().length>0;
    const emailValid=emailField.validity.valid;
    const phoneValid=phoneField.validity.valid && phoneField.value.replace(/\D/g,'').length>=7;
    phoneField.setCustomValidity(phoneField.value&&phoneField.value.replace(/\D/g,'').length<7?'Enter a valid contact number.':'');
    if(validation)validation.textContent=!firstNameField.value&&!lastNameField.value&&!emailField.value&&!phoneField.value?'':!nameValid?'Enter the primary guest’s first and last name.':!emailValid?'Enter a valid email address.':!phoneValid?'Enter a valid contact number.':!consentField.checked?'Please agree to the booking request terms.':'';
    emailField.setAttribute('aria-invalid',String(Boolean(emailField.value)&&!emailValid));
    phoneField.setAttribute('aria-invalid',String(Boolean(phoneField.value)&&!phoneValid));
  }
  firstNameField.addEventListener('input',validateContact);
  lastNameField.addEventListener('input',validateContact);
  emailField.addEventListener('input',validateContact);
  phoneField.addEventListener('input',validateContact);
  consentField.addEventListener('change',validateContact);
  detailsForm.addEventListener('submit',event=>{event.preventDefault();validateContact();});
  const disabledConfirm=detailsForm.querySelector<HTMLButtonElement>('[disabled]');
  if(disabledConfirm)disabledConfirm.disabled=true;

  arrival.addEventListener('change',()=>{if(arrival.value){departure.min=plusDays(arrival.value,7);}});
  void search();
}
