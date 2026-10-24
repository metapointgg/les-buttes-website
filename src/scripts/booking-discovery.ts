import {canPickCheckout,daysForMonth,indicativeSelection,matchingOptions,nightsInRange,plusDays,possibleNight,type CottageChoice,type SearchFilters} from '../lib/booking-discovery';

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
  const lang=widget.dataset.locale==='fr'?'fr-FR':widget.dataset.locale==='nl'?'nl-NL':'en-GB';
  const money=(v:number)=>new Intl.NumberFormat(lang,{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(v);
  const readable=(date:string,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(lang,{...opts,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  const rangeLabel=(start:string,end:string)=>new Intl.DateTimeFormat(lang,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).formatRange(new Date(start+'T00:00:00Z'),new Date(end+'T00:00:00Z'));
  const formatDay=(date:string)=>readable(date,{weekday:'long',day:'numeric',month:'long'});
  let choice:CottageChoice|null=null,month='2027-03',pendingStart:string|null=null;
  let filters:SearchFilters={adults:2,children:0,bedrooms:0,choice:'any'};
  const monthShift=(m:string,n:number)=>{
    const [year,mo]=m.split('-').map(Number);
    return new Date(Date.UTC(year,mo-1+n,1)).toISOString().slice(0,7);
  };
  const fill=(selector:string,value:string)=>{
    const el=widget.querySelector<HTMLElement>(selector);
    if(el)el.textContent=value;
  };
  function newFilters():SearchFilters{
    return {adults:Number(get('adults').value),children:Number(get('children').value),
      bedrooms:Number(get('bedrooms').value),choice:get('choice').value==='both'?'both':'any'};
  }
  function updateResults(){
    const candidates=matchingOptions(filters,arrival.value||undefined,departure.value||undefined);
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
      return;
    }
    if(!choice||!candidates.some(c=>c.unit===choice)){
      choice=candidates.find(c=>c.listedAs!=='occupied')?.unit??candidates[0].unit;
      pendingStart=null;
    }
    feedback.textContent=arrival.value&&departure.value&&candidates.every(c=>c.listedAs==='occupied')
      ?tr('blocked'):tr('notConfirmed');
    calendarSection.hidden=false;
    if(arrival.value)month=arrival.value.slice(0,7);
    renderCalendars();
    renderSummary();
    for(const card of optionCards){
      const unit=card.dataset.discoveryOption as CottageChoice;
      card.classList.toggle('is-selected',unit===choice);
      const button=card.querySelector<HTMLButtonElement>('[data-select-option]');
      if(button&&(!card.hidden)){button.textContent=unit===choice?tr('choice'):tr('pick');button.setAttribute('aria-pressed',String(unit===choice));}
    }
  }
  function renderSummary(){
    summarySection.hidden=true;
    if(!choice||!arrival.value||!departure.value)return;
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
    calendarGrids.classList.toggle('two-cottages',choice==='both');
    const names=choice==='both'?(['geranium','honeysuckle'] as const):([choice] as const);
    const firstDate=month+'-01';
    monthLabel.textContent=readable(firstDate,{month:'long',year:'numeric'});
    prev.disabled=month<='2027-03';next.disabled=month>='2027-10';
    const weekdays=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(lang,{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2027,2,22+i))));
    for(const unit of names){
      const section=document.createElement('div');section.className='calendar-cottage';
      const title=document.createElement('h3');title.className='calendar-cottage-title';
      title.textContent=unit==='geranium'?'Geranium Cottage':'Honeysuckle Cottage';
      section.appendChild(title);
      const week=document.createElement('div');week.className='calendar-weekdays';
      for(const wd of weekdays){const el=document.createElement('span');el.textContent=wd;week.appendChild(el);}
      section.appendChild(week);
      const grid=document.createElement('div');grid.className='calendar-days';
      const pad=(new Date(firstDate+'T00:00:00Z').getUTCDay()+6)%7;
      for(let i=0;i<pad;i++){const blank=document.createElement('span');blank.className='calendar-empty';grid.appendChild(blank);}
      for(const d of daysForMonth(unit,month)){
        const date=d.date;
        const between=!!arrival.value&&!!departure.value&&date>=arrival.value&&date<departure.value;
        const marked=date===pendingStart||date===arrival.value||date===departure.value;
        const checkoutAllowed=!!pendingStart&&pendingStart<date&&canPickCheckout(choice,pendingStart,date);
        const isStartAllowed=possibleNight(choice,date);
        const button=document.createElement('button');button.type='button';
        const isDisabled=!isStartAllowed&&!checkoutAllowed;
        button.disabled=isDisabled;
        button.className=[d.status==='occupied'?'is-blocked':d.status==='closed'?'is-closed':'',between?'is-between':'',marked?'is-selected':''].filter(Boolean).join(' ');
        button.title=formatDay(date)+': '+(d.status==='occupied'?tr('dateBlocked'):d.status==='closed'?tr('closed'):tr('possibleDate'));
        button.setAttribute('aria-label',button.title+(d.rateGBP?' · '+money(d.rateGBP):''));
        button.setAttribute('aria-pressed',String(marked));
        const num=document.createElement('span');num.className='calendar-day';num.textContent=String(Number(date.slice(-2)));
        const rate=document.createElement('small');rate.className='calendar-rate';
        rate.textContent=d.status==='occupied'?'×':d.status==='closed'?'':d.rateGBP?money(d.rateGBP):'';
        button.append(num,rate);
        if(!isDisabled)button.addEventListener('click',()=>selectDate(date));
        grid.appendChild(button);
      }
      section.appendChild(grid);calendarGrids.appendChild(section);
    }
  }
  function selectDate(date:string){
    if(!choice)return;
    // One click selects arrival; second click selects checkout (excluded from occupied nights).
    if(!pendingStart||date<=pendingStart||!canPickCheckout(choice,pendingStart,date)){
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
  function search(){
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
      try{nightsInRange(arrival.value,departure.value);}
      catch{feedback.textContent=tr('invalid');summarySection.hidden=true;return;}
    }
    updateResults();
  }
  form.addEventListener('submit',event=>{event.preventDefault();search();});
  for(const card of optionCards){
    card.querySelector<HTMLButtonElement>('[data-select-option]')?.addEventListener('click',()=>{
      choice=card.dataset.discoveryOption as CottageChoice;
      pendingStart=null;calendarMessage.textContent='';
      updateResults();
      calendarSection.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
  prev.addEventListener('click',()=>{month=monthShift(month,-1);renderCalendars();});
  next.addEventListener('click',()=>{month=monthShift(month,1);renderCalendars();});
  arrival.addEventListener('change',()=>{if(arrival.value){departure.min=plusDays(arrival.value,1);}});
  search();
}
