import {canPickCheckout,clearMasterAvailability,daysForMonth,indicativeSelection,masterConnected,matchingCottages,matchingOptions,nightsInRange,possibleNight,setMasterAvailability,type CottageChoice,type SearchFilters} from '../lib/booking-discovery';

const widget=document.querySelector<HTMLElement>('[data-discovery]');
if(widget){
  const t:Record<string,string|string[]>=JSON.parse(widget.dataset.copy??'{}');
  const tr=(key:string)=>typeof t[key]==='string'?t[key] as string:key;
  const form=widget.querySelector<HTMLFormElement>('[data-discovery-search]')!;
  const get=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement;
  const arrival=get('arrival') as HTMLInputElement,departure=get('departure') as HTMLInputElement;
  const rangeTrigger=widget.querySelector<HTMLButtonElement>('[data-range-trigger]')!;
  const rangeSummary=widget.querySelector<HTMLElement>('[data-range-summary]')!;
  const rangePicker=widget.querySelector<HTMLElement>('[data-range-picker]')!;
  const rangeMonths=widget.querySelector<HTMLElement>('[data-range-months]')!;
  const rangeMessage=widget.querySelector<HTMLElement>('[data-range-message]')!;
  const rangeLabelNode=widget.querySelector<HTMLElement>('[data-range-month-label]')!;
  const rangePrev=widget.querySelector<HTMLButtonElement>('[data-range-prev]')!;
  const rangeNext=widget.querySelector<HTMLButtonElement>('[data-range-next]')!;
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
  // Each build must explicitly allow its own host and read-only environment.
  const allowedHosts=(import.meta.env.PUBLIC_BOOKING_READ_ONLY_ALLOWED_HOSTS??
    import.meta.env.PUBLIC_BOOKING_STAGING_ALLOWED_HOSTS??'')
    .split(',').map((host:string)=>host.trim().toLowerCase()).filter(Boolean);
  const hostedReadOnlyEnabled=(import.meta.env.PUBLIC_BOOKING_READ_ONLY_ENABLED??
    import.meta.env.PUBLIC_BOOKING_STAGING_READ_ONLY_ENABLED)==='true' &&
    allowedHosts.includes(window.location.hostname.toLowerCase()) && !localPreview;
  const availabilityUrl=localPreview?'http://127.0.0.1:4328/availability':
    hostedReadOnlyEnabled?(import.meta.env.PUBLIC_BOOKING_AVAILABILITY_URL??null):null;
  let fetchSequence=0;
  const lang=widget.dataset.locale==='fr'?'fr-FR':widget.dataset.locale==='nl'?'nl-NL':'en-GB';
  const money=(v:number)=>new Intl.NumberFormat(lang,{style:'currency',currency:'GBP',minimumFractionDigits:0,maximumFractionDigits:2}).format(v);
  const readable=(date:string,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(lang,{...opts,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  const rangeLabel=(start:string,end:string)=>new Intl.DateTimeFormat(lang,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).formatRange(new Date(start+'T00:00:00Z'),new Date(end+'T00:00:00Z'));
  const formatDay=(date:string)=>readable(date,{weekday:'long',day:'numeric',month:'long'});
  let choice:CottageChoice|null=null,month='2027-03',pendingStart:string|null=null;
  let rangeMonth='2027-03',rangePendingStart:string|null=null;
  let filters:SearchFilters={adults:2,children:0,bedrooms:0,choice:'any'};
  let activeStep=1;
  const screens=Array.from(widget.querySelectorAll<HTMLElement>('[data-booking-step]'));
  const indicators=Array.from(widget.querySelectorAll<HTMLElement>('[data-journey-indicator]'));
  const reviewNext=widget.querySelector<HTMLButtonElement>('[data-continue-details]')!;
  let activateChallenge=()=>{};
  const detailsForm=widget.querySelector<HTMLFormElement>('[data-preview-guest-details]')!;
  // A server-authoritative quote is mandatory before advancing from availability to guest details.
  // The existing staging read-only master never authorises a request or payment.
  const bookingApi=(import.meta.env.PUBLIC_BOOKING_REQUEST_API_URL??'').trim().replace(/\/$/,'');
  // A quote-only API is separate from the booking request API and can never submit.
  const quoteUrl=hostedReadOnlyEnabled?
    (import.meta.env.PUBLIC_BOOKING_QUOTE_URL??
      import.meta.env.PUBLIC_BOOKING_STAGING_QUOTE_URL??'').trim(): '';
  const quoteOnlyEnabled=Boolean(quoteUrl)&&
    /^https:\/\/[a-z0-9.-]+\.execute-api\.eu-west-2\.amazonaws\.com\/quote$/i.test(quoteUrl);
  const liveQuoteEnabled=import.meta.env.PUBLIC_BOOKING_AUTHORITATIVE_QUOTES_ENABLED==='true'&&
    (quoteOnlyEnabled||Boolean(bookingApi))&&!localPreview;
  // Submission is separately gated and cannot be enabled by an API URL alone.
  // The private staging API is never an acceptable browser endpoint.
  const syntheticRequestEnabled=import.meta.env.PUBLIC_BOOKING_SYNTHETIC_REQUESTS_ENABLED==='true'&&
    window.location.hostname==='d123fnjf47zmyp.cloudfront.net'&&hostedReadOnlyEnabled&&quoteOnlyEnabled&&liveQuoteEnabled;
  const syntheticRequestUrl='https://75im3kpaq6.execute-api.eu-west-2.amazonaws.com/request';
  // Production needs the separate read-only quote endpoint AND the write-capable
  // production API. A quote-only endpoint is never a request destination.
  const productionRequestApi=bookingApi==='https://c7x0ongl4d.execute-api.eu-west-2.amazonaws.com';
  // Owner acceptance URL is explicit, but the API still requires the private
  // one-time SSM token, exact Geranium details and a single conditional claim.
  const controlledOwnerTest=import.meta.env.PUBLIC_BOOKING_CONTROLLED_TEST_ENABLED==='true'&&
    window.location.hostname==='lesbuttes.com'&&
    new URLSearchParams(window.location.search).get('owner-test')==='payment-email-2027'&&
    quoteOnlyEnabled&&liveQuoteEnabled&&productionRequestApi&&
    Boolean(import.meta.env.PUBLIC_BOOKING_TURNSTILE_SITE_KEY);
  const requestEnabled=syntheticRequestEnabled||controlledOwnerTest||
    import.meta.env.PUBLIC_BOOKING_REQUESTS_ENABLED==='true'&&
    import.meta.env.PUBLIC_BOOKING_REQUESTS_APPROVED==='true'&&hostedReadOnlyEnabled&&
    quoteOnlyEnabled&&liveQuoteEnabled&&productionRequestApi&&Boolean(import.meta.env.PUBLIC_BOOKING_TURNSTILE_SITE_KEY);

  type PaymentSplit={totalPence:number;dueNowPence:number;balancePence:number;
    dueDate:string|null;depositPercent:number;policyVersion:string|null};
  let authoritativeQuote:{key:string;totalGBP:string;payment?:PaymentSplit}|null=null;
  const splitLabels=({
   en:{dueNow:'Pay after owner approval',balance:'Remaining balance due',full:'Full payment due after approval'},
   fr:{dueNow:'À payer après validation',balance:'Solde à régler le',full:'Paiement intégral après validation'},
   nl:{dueNow:'Te betalen na goedkeuring',balance:'Restbedrag te betalen op',full:'Volledige betaling na goedkeuring'}
  } as const)[lang==='fr'?'fr':lang==='nl'?'nl':'en'];
  function showPaymentSplit(){
   if(!authoritativeQuote?.payment)return;
   const p=authoritativeQuote.payment;
   if(!Number.isSafeInteger(p.totalPence)||!Number.isSafeInteger(p.dueNowPence)||
      !Number.isSafeInteger(p.balancePence)||p.totalPence!==p.dueNowPence+p.balancePence)return;
   const lines:[[string,string],...[string,string][]]=[
    [p.balancePence?splitLabels.dueNow:splitLabels.full,'£'+(p.dueNowPence/100).toFixed(2)],
    ...(p.balancePence&&p.dueDate?
       [[splitLabels.balance+' '+p.dueDate,'£'+(p.balancePence/100).toFixed(2)] as [string,string]]:[])
   ];
   summaryLines.replaceChildren();
   for(const [label,amount] of lines){
    const row=document.createElement('div');row.className='summary-line';
    const name=document.createElement('span');name.textContent=label;
    const price=document.createElement('strong');price.textContent=amount;
    row.append(name,price);summaryLines.append(row);
   }
   summaryLines.hidden=false;
  }
  const quoteKey=()=>JSON.stringify([choice,arrival.value,departure.value,filters.adults+filters.children]);
  async function checkAuthoritativeQuote(){
    authoritativeQuote=null;
    if(!liveQuoteEnabled||!choice||!masterConnected()||!weekly(arrival.value,departure.value))return false;
    const key=quoteKey();
    const params=new URLSearchParams({unit:choice,start:arrival.value,end:departure.value,
      guests:String(filters.adults+filters.children)});
    try{
      const response=await fetch(quoteOnlyEnabled?quoteUrl+'?'+params:
        bookingApi+'/availability?'+params,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)return false;
      const result=await response.json() as {
        available?:boolean;quote?:{currency?:string;totalGBP?:string};
        currency?:string;totalGBP?:string;bookingConfirmed?:boolean;payment?:PaymentSplit
      };
      const totalGBP=quoteOnlyEnabled?
        (result.currency==='GBP'&&result.bookingConfirmed===false?result.totalGBP:undefined):
        (result.available===true&&result.quote?.currency==='GBP'?result.quote.totalGBP:undefined);
      if(!/^\d+(?:\.\d{1,2})?$/.test(totalGBP??''))return false;
      if(key!==quoteKey())return false;
      const payment=result.payment;
      const totalPence=Math.round(Number(totalGBP)*100);
      if(payment&&(!Number.isSafeInteger(payment.dueNowPence)||payment.dueNowPence<1||
         !Number.isSafeInteger(payment.balancePence)||payment.balancePence<0||
         payment.dueNowPence+payment.balancePence!==totalPence))return false;
      authoritativeQuote={key,totalGBP:totalGBP!,payment};
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
    // Keep browser scrolling predictable when moving between the three screens.
    widget.scrollIntoView({behavior:'smooth',block:'start'});
    heading?.setAttribute('tabindex','-1');
    heading?.focus({preventScroll:true});
    if(step===3)activateChallenge();
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
    reviewNext.disabled=!masterConnected()||!q||!q.meetsDraftMinimum||
      (liveQuoteEnabled&&authoritativeQuote?.key!==quoteKey());
    reviewNext.setAttribute('aria-disabled',String(!masterConnected()));
    const note=widget.querySelector<HTMLElement>('[data-selection-feedback]');
    if(note)note.textContent=!masterConnected()?tr('masterOffline'):
      !q?tr('datesNeeded'):!q.meetsDraftMinimum?tr('tooShort'):'';
    const searchSummary=widget.querySelector<HTMLElement>('[data-journey-selection]');
    if(searchSummary)searchSummary.textContent=filters.adults+' '+tr('adults')+' · '+filters.children+' '+tr('children')+
      (arrival.value&&departure.value?' · '+rangeLabel(arrival.value,departure.value):'');
  };

  const monthShift=(m:string,n:number)=>{
    const [year,mo]=m.split('-').map(Number);
    return new Date(Date.UTC(year,mo-1+n,1)).toISOString().slice(0,7);
  };
  // Search-stage range picker: the selected dates remain the same hidden form
  // inputs used by the quote, cottage selection and booking request journey.
  const eligibleSearchUnits=()=>matchingCottages({...newFilters(),choice:'any'});
  const canStartSearchRange=(date:string)=>saturday(date)&&
    eligibleSearchUnits().some(unit=>possibleNight(unit,date));
  const canFinishSearchRange=(start:string,end:string)=>weekly(start,end)&&
    eligibleSearchUnits().some(unit=>canPickCheckout(unit,start,end));
  const rangeMonthLabel=(date:string)=>readable(date+'-01',{month:'long',year:'numeric'});
  const renderRangeSummary=()=>{
    rangeSummary.textContent=arrival.value&&departure.value?
      rangeLabel(arrival.value,departure.value):arrival.value?
      readable(arrival.value,{day:'numeric',month:'short',year:'numeric'})+' — '+tr('departure'):
      tr('rangePlaceholder');
  };
  const closeRangePicker=(restoreFocus=false)=>{
    rangePicker.hidden=true;
    rangeTrigger.setAttribute('aria-expanded','false');
    if(restoreFocus)rangeTrigger.focus();
  };
  function renderRangePicker(){
    rangeMonths.replaceChildren();
    const compact=window.matchMedia('(max-width: 44rem)').matches;
    const shown=compact?[rangeMonth]:[rangeMonth,monthShift(rangeMonth,1)];
    rangeLabelNode.textContent=shown.map(rangeMonthLabel).join(' – ');
    rangePrev.disabled=rangeMonth<='2027-03';
    rangeNext.disabled=rangeMonth>=(compact?'2027-10':'2027-09');
    const weekdays=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(lang,{
      weekday:'narrow',timeZone:'UTC'
    }).format(new Date(Date.UTC(2027,2,22+i))));
    for(const m of shown){
      const panel=document.createElement('div');
      panel.className='search-range-month';
      const title=document.createElement('h4');
      title.className='search-range-month-title';
      title.textContent=rangeMonthLabel(m);
      panel.appendChild(title);
      const labels=document.createElement('div');
      labels.className='search-range-weekdays';
      for(const weekday of weekdays){
        const cell=document.createElement('span');cell.textContent=weekday;labels.appendChild(cell);
      }
      panel.appendChild(labels);
      const days=document.createElement('div');days.className='search-range-days';
      const first=m+'-01',offset=(new Date(first+'T00:00:00Z').getUTCDay()+6)%7;
      for(let i=0;i<offset;i++)days.appendChild(document.createElement('span'));
      const [year,monthNumber]=m.split('-').map(Number);
      const count=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
      for(let day=1;day<=count;day++){
        const date=m+'-'+String(day).padStart(2,'0');
        const checkout=!!rangePendingStart&&date>rangePendingStart&&
          canFinishSearchRange(rangePendingStart,date);
        const selectable=checkout||canStartSearchRange(date);
        const start=date===(rangePendingStart||arrival.value);
        const end=!!departure.value&&date===departure.value;
        const between=!!arrival.value&&!!departure.value&&
          date>arrival.value&&date<departure.value;
        const button=document.createElement('button');
        button.type='button';
        button.textContent=String(day);
        button.disabled=!selectable;
        button.className=[between?'is-between':'',start?'is-checkin':'',end?'is-checkout':''].filter(Boolean).join(' ');
        button.setAttribute('aria-label',formatDay(date));
        button.setAttribute('aria-pressed',String(start||end));
        if(selectable)button.addEventListener('click',()=>{void selectSearchRangeDate(date);});
        days.appendChild(button);
      }
      panel.appendChild(days);rangeMonths.appendChild(panel);
    }
  }
  async function selectSearchRangeDate(date:string){
    // Revalidate the snapshot at checkout selection; fail closed on stale data.
    if(!await refreshMaster()){
      rangeMessage.textContent=tr('masterOffline');renderRangePicker();return;
    }
    if(rangePendingStart&&date>rangePendingStart&&canFinishSearchRange(rangePendingStart,date)){
      arrival.value=rangePendingStart;
      departure.value=date;
      rangePendingStart=null;
      pendingStart=null;
      // The search calendar may find dates available in only one cottage.
      // Re-evaluate which cottage is selected using the completed date range.
      choice=null;
      month=arrival.value.slice(0,7);
      closeRangePicker(true);
      rangeMessage.textContent='';
    }else if(canStartSearchRange(date)){
      arrival.value=date;departure.value='';
      rangePendingStart=date;
      rangeMessage.textContent=tr('selectStart');
    }else{
      rangeMessage.textContent=tr('different');
    }
    renderRangeSummary();renderRangePicker();
    filters=newFilters();updateResults();
  }
  async function openRangePicker(){
    if(!rangePicker.hidden){closeRangePicker(true);return;}
    rangeMonth=arrival.value?arrival.value.slice(0,7):'2027-03';
    rangePendingStart=arrival.value&&!departure.value?arrival.value:null;
    rangePicker.hidden=false;
    rangeTrigger.setAttribute('aria-expanded','true');
    rangeMessage.textContent=tr('rangeLoading');
    renderRangePicker();
    const connected=await refreshMaster();
    if(rangePicker.hidden)return;
    rangeMessage.textContent=!connected?tr('masterOffline'):
      rangePendingStart?tr('selectStart'):tr('rangeHint');
    renderRangePicker();
    rangePicker.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  rangeTrigger.addEventListener('click',()=>{void openRangePicker();});
  widget.querySelector<HTMLButtonElement>('[data-range-close]')?.addEventListener('click',()=>closeRangePicker(true));
  rangePrev.addEventListener('click',()=>{rangeMonth=monthShift(rangeMonth,-1);renderRangePicker();});
  rangeNext.addEventListener('click',()=>{rangeMonth=monthShift(rangeMonth,1);renderRangePicker();});
  document.addEventListener('pointerdown',event=>{
    if(!rangePicker.hidden&&event.target instanceof Node&&
      !rangePicker.contains(event.target)&&!rangeTrigger.contains(event.target))
      closeRangePicker();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!rangePicker.hidden){event.preventDefault();closeRangePicker(true);}
  });
  window.addEventListener('resize',()=>{if(!rangePicker.hidden)renderRangePicker();});
  renderRangeSummary();
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
      // The master timestamp is an internal diagnostic, not guest-facing copy.
      fill('[data-master-status]','');
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
      arrival.value&&departure.value&&candidates.every(c=>c.listedAs==='occupied')?tr('blocked'):'';
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
      summaryLines.hidden=liveQuoteEnabled;
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
      fill('[data-summary-minimum]',quote.meetsDraftMinimum?'':tr('tooShort'));
      // In the live booking interface, never present the illustrative discount
      // as an authoritative price. Display the provider-independent database quote.
      for(const selector of ['[data-summary-airbnb]','[data-summary-saving]']){
        const element=summarySection.querySelector<HTMLElement>(selector);
        if(element?.parentElement)element.parentElement.hidden=liveQuoteEnabled;
      }
      if(liveQuoteEnabled){
        reviewNext.disabled=true;
        fill('[data-summary-direct]','…');
        const expected=quoteKey();
        void checkAuthoritativeQuote().then(ok=>{
          if(expected!==quoteKey()||summarySection.hidden)return;
          if(ok&&authoritativeQuote?.key===expected){
            fill('[data-summary-direct]',money(Number(authoritativeQuote.totalGBP)));
            showPaymentSplit();
          }
          else fill('[data-summary-direct]','Unavailable');
          updateNext();
          if(!ok)reviewNext.disabled=true;
        });
      }
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
          button.setAttribute('aria-label',button.title+(!liveQuoteEnabled&&d.rateGBP?' · '+money(d.rateGBP):''));
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
    if(advance&&(!arrival.value||!departure.value)){
      feedback.textContent=tr('datesNeeded');
      if(rangePicker.hidden)await openRangePicker();
      return;
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
  onClick('[data-continue-details]',async()=>{
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
    // The calendar-side summary and guest details must use the same independently
    // checked database quote; a preview total is not approval to submit.
    if(liveQuoteEnabled&&authoritativeQuote?.key===quoteKey())
      fill('[data-summary-direct]',money(Number(authoritativeQuote.totalGBP)));
    fill('[data-details-cottage]',quote.units.map(item=>item.unit==='geranium'?'Geranium':'Honeysuckle').join(' + '));
    fill('[data-details-stay]',rangeLabel(quote.start,quote.end)+' · '+quote.nights+' '+tr('nightWord'));
    fill('[data-details-guests]',String(quote.adults+quote.children));
    fill('[data-details-price]',liveQuoteEnabled&&authoritativeQuote?.key===quoteKey()?money(Number(authoritativeQuote.totalGBP)):money(quote.indicativeDirectTotalGBP));
    setStep(3);
  });
  // Submission requires an explicit build flag and an authoritative quote.
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
  const confirmButton=detailsForm.querySelector<HTMLButtonElement>('[disabled]');
  const status=validation;
  let submitting=false;
  const siteKey=(import.meta.env.PUBLIC_BOOKING_TURNSTILE_SITE_KEY??'').trim();
  // The public Site Key may be exposed in the read-only website. Retain it in
  // the built four-stage page even when guest submissions are disabled; this
  // does not load Turnstile or enable the release-gated request action.
  if(siteKey)widget.dataset.turnstileSiteKey=siteKey;
  const challengeSlot=document.createElement('div');
  if(syntheticRequestEnabled&&confirmButton){
    firstNameField.value='Synthetic';
    lastNameField.value='Guest';
    emailField.value='test@example.invalid';
    phoneField.value='01481000000';
    for(const field of [firstNameField,lastNameField,emailField,phoneField])field.readOnly=true;
    const notice=document.createElement('p');
    notice.textContent='Staging test booking. Uses synthetic guest details and sandbox payment only.';
    detailsForm.prepend(notice);
    confirmButton.textContent='Submit synthetic booking request';
    confirmButton.type='submit';
    confirmButton.disabled=false;
    confirmButton.setAttribute('aria-disabled','false');
  }
  if(requestEnabled&&!syntheticRequestEnabled&&confirmButton){
    const detailsIntro=widget.querySelector<HTMLElement>('[data-booking-step="3"] .journey-stage-heading p:last-child');
    if(detailsIntro)detailsIntro.textContent='Enter the lead guest details for this reservation request.';
    confirmButton.textContent='Submit reservation request';
    challengeSlot.setAttribute('data-turnstile-slot','');
    confirmButton.before(challengeSlot);
    confirmButton.type='submit';
    confirmButton.setAttribute('aria-disabled','false');
    // A token may expire while the guest searches or fills in details.
    // Initialise the challenge only on the final step and reset on re-entry.
    let rendered=false,loading=false;
    const renderChallenge=()=>{
      const turnstile=(window as typeof window & {turnstile?:{
        render:(element:HTMLElement,options:{sitekey:string;'expired-callback':()=>void;'error-callback':()=>void})=>string;
        reset:()=>void
      }}).turnstile;
      if(!turnstile)return false;
      if(rendered){turnstile.reset();return true;}
      turnstile.render(challengeSlot,{sitekey:siteKey,
        'expired-callback':()=>{if(status)status.textContent='Verification expired. Please complete the challenge again.';},
        'error-callback':()=>{if(status)status.textContent='Verification is temporarily unavailable. Please retry the challenge.';}
      });
      rendered=true;
      return true;
    };
    activateChallenge=()=>{
      if(renderChallenge())return;
      if(loading)return;
      loading=true;
      // Only load the public challenge on the explicitly authorised guest-details step.
      const challengeScript=document.createElement('script');
      challengeScript.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      challengeScript.async=true;
      challengeScript.defer=true;
      document.head.append(challengeScript);
      let attempts=0;
      const timer=window.setInterval(()=>{
        if(renderChallenge()||++attempts>=60)window.clearInterval(timer);
      },150);
    };
    confirmButton.disabled=false;
  }
  detailsForm.addEventListener('submit',async event=>{
    event.preventDefault();
    validateContact();
    if(!requestEnabled||!confirmButton||submitting)return;
    if(!detailsForm.reportValidity()||!consentField.checked||
       !firstNameField.value.trim()||!lastNameField.value.trim()||
       phoneField.value.replace(/\D/g,'').length<7)return;
    submitting=true;
    confirmButton.disabled=true;
    try{
      if(!await refreshMaster())throw Error('Availability is currently unavailable.');
      const q=getQuote();
      if(!q||!q.meetsDraftMinimum||!await checkAuthoritativeQuote()||
         authoritativeQuote?.key!==quoteKey())throw Error('The selected dates or price are no longer available.');
      const turnstile=(window as typeof window & {turnstile?:{getResponse:()=>string;reset:()=>void}}).turnstile;
      const token=syntheticRequestEnabled?'XXXX.DUMMY.TOKEN.XXXX':turnstile?.getResponse()??'';
      if(!token)throw Error('Please complete the verification challenge.');
      if(controlledOwnerTest&&(choice!=='geranium'||arrival.value!=='2027-04-10'||
        departure.value!=='2027-04-17'||filters.adults+filters.children!==2||
        emailField.value.trim().toLowerCase()!=='mike@un1ty.gg'))
        throw Error('Owner test requires Geranium, 10–17 April 2027, two guests and mike@un1ty.gg.');
      const oneTimeAccess=controlledOwnerTest?
        (window.prompt('Enter the one-time controlled test access code from AWS Parameter Store')??'').trim():undefined;
      if(controlledOwnerTest&&(!oneTimeAccess||oneTimeAccess.length<32))
        throw Error('A valid one-time test access code is required.');
      const response=await fetch(syntheticRequestEnabled?syntheticRequestUrl:bookingApi+'/requests',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(syntheticRequestEnabled?{
          unit:choice,start:arrival.value,end:departure.value,adults:filters.adults,children:filters.children,
          firstName:'Synthetic',lastName:'Guest',email:'test@example.invalid',telephone:'01481000000',
          consent:true,notes:'',turnstileToken:token
        }:{
          unit:choice,start:arrival.value,end:departure.value,
          guests:filters.adults+filters.children,
          name:firstNameField.value.trim()+' '+lastNameField.value.trim(),
          email:emailField.value.trim(),telephone:phoneField.value.trim(),
          consent:true,notes:'',website:'',turnstileToken:token,
          termsAcceptance:{accepted:true,termsVersion:'LB-DIRECT-2027-01',privacyVersion:'LB-PRIVACY-2027-01'},
          ...(controlledOwnerTest?{testAccessCode:oneTimeAccess}:{})
        })
      });
      if(response.status!==(syntheticRequestEnabled?201:202)){
        if(response.status===403)throw Error('Verification was rejected or your restricted test access is no longer valid. Please refresh and try again.');
        if(response.status===409)throw Error(controlledOwnerTest?
          'This one-time owner booking test has already been used. A new test authorisation is required.':
          'These dates have just become unavailable. Please select another stay.');
        throw Error(response.status===503?
          'Booking requests are temporarily unavailable. Please try again later.':
          'Your booking request could not be submitted. Please try again.');
      }
      const result=await response.json() as {received?:boolean;reference?:string};
      if(result.received!==true||!result.reference)throw Error('A booking reference was not returned.');
      // Replace the form with a dedicated confirmation, not a stale "Your details" screen.
      const heading=widget.querySelector<HTMLElement>('#journey-three-heading');
      if(heading)heading.textContent='Request received';
      const intro=widget.querySelector<HTMLElement>('[data-booking-step="3"] .journey-stage-heading>p:not(.eyebrow)');
      if(intro)intro.textContent='Thank you for choosing Les Buttes. We have received your request.';
      const progress=widget.querySelector<HTMLElement>('[data-journey-indicator="3"] span:last-child');
      if(progress)progress.textContent='Request received';
      detailsForm.replaceChildren();
      detailsForm.classList.add('journey-request-success');
      detailsForm.setAttribute('role','status');
      detailsForm.setAttribute('aria-live','polite');
      const title=document.createElement('h3');
      title.textContent='Thank you — your request is with us';
      const message=document.createElement('p');
      message.textContent='We have emailed you a copy of your request. We will review your dates and contact you once the owner has made a decision.';
      const referenceLabel=document.createElement('p');
      referenceLabel.className='journey-request-reference-label';
      referenceLabel.textContent='YOUR BOOKING REFERENCE';
      const reference=document.createElement('p');
      reference.className='journey-request-reference';
      reference.textContent=result.reference;
      const next=document.createElement('p');
      next.className='journey-request-next';
      next.textContent='Your reservation is provisional until approved. No payment has been taken.';
      detailsForm.append(title,message,referenceLabel,reference,next);
      const backActions=widget.querySelector<HTMLElement>('[data-booking-step="3"] .journey-actions');
      if(backActions)backActions.style.display='none';
    }catch(error){
      if(status)status.textContent=error instanceof Error?error.message:'Unable to submit the request.';
      const turnstile=(window as typeof window & {turnstile?:{reset:()=>void}}).turnstile;
      turnstile?.reset();
      confirmButton.disabled=false;
    }finally{submitting=false;}
  });
  if(!requestEnabled&&confirmButton)confirmButton.disabled=true;

  void search();
}
