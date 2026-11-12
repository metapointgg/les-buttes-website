import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=(name)=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const publicData=JSON.parse(readFileSync(new URL('../../../src/data/booking-preview-2027.json',import.meta.url),'utf8'));
const units=['geranium','honeysuckle'];
const observed=Object.fromEntries(units.map(unit=>[unit,load('config/observed-airbnb-'+unit+'-2027.json')]));
const precedent=load('config/direct-pricing-approach-2027.json').actualDirectBookingPrecedent;
const dateNumber=(date)=>Date.parse(date+'T00:00:00.000Z');
const iso=(n)=>new Date(n).toISOString().slice(0,10);
const nights=(a,b)=>Array.from({length:(dateNumber(b)-dateNumber(a))/86400000},(_,i)=>iso(dateNumber(a)+i*86400000));
const exact=(rows,date,from='from',to='to')=>{
  const matches=rows.filter(row=>date>=row[from]&&date<=row[to]);
  assert.equal(matches.length,1,'expected one covering price/season row for '+date);
  return matches[0];
};

test('public booking preview rates match both verified Airbnb screenshots for all 196 2027 holiday nights',()=>{
  assert.equal(publicData.mode,'OWNER_REVIEW_PREVIEW_NOT_LIVE');
  assert.equal(publicData.firstNight,'2027-03-20');
  assert.equal(publicData.lastCheckout,'2027-10-02');
  const days=nights(publicData.firstNight,publicData.lastCheckout);
  assert.equal(days.length,196);
  for(const unit of units)for(const date of days){
    assert.equal(exact(publicData.nights[unit],date).gbp,
      exact(observed[unit].displayedNightlyRatesGBP,date,'start','end').amount);
    const minimum=exact(publicData.proposedMinimumStays,date);
    assert.ok([3,5,7].includes(minimum.nights));
  }
  assert.deepEqual(publicData.guestLimits,{geranium:4,honeysuckle:6,both:10});
  assert.equal(publicData.pricing.feesAlreadyIncludedInAirbnbRates,true);
  assert.equal(publicData.pricing.indicativeSavingPercent,11);
});
test('preview per-cottage seven-night rounding reproduces the existing direct agreement but never modifies it',()=>{
  const days=nights('2027-08-28','2027-09-04');
  let actualTotal=0,directTotal=0;
  for(const unit of units){
    const amount=days.reduce((total,date)=>total+exact(publicData.nights[unit],date).gbp,0);
    const suggested=Math.round((amount*(1-publicData.pricing.indicativeSavingPercent/100))/publicData.pricing.roundWeeklyGBP)*publicData.pricing.roundWeeklyGBP;
    assert.equal(amount,precedent.units[unit].airbnbComparableGBP);
    assert.equal(suggested,precedent.units[unit].agreedDirectGBP);
    actualTotal+=amount;directTotal+=suggested;
  }
  assert.equal(actualTotal,3475);
  assert.equal(directTotal,3100);
});
test('hidden page never enables submissions from API URL alone; EN/NL/FR use same page and noindex',()=>{
  const page=readFileSync(new URL('../../../src/components/BookingRequestPage.astro',import.meta.url),'utf8');
  const sitemap=readFileSync(new URL('../../../src/pages/sitemap.xml.ts',import.meta.url),'utf8');
  const header=readFileSync(new URL('../../../src/components/Header.astro',import.meta.url),'utf8');
  const deployment=readFileSync(new URL('../../../.github/workflows/deploy.yml',import.meta.url),'utf8');
  assert.match(page,/noindex>/);
  const discovery=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
  const discoveryScript=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
  assert.match(page,/<BookingDiscoveryPreview\/>/);
  assert.doesNotMatch(page,/data-booking-form|booking-form/);
  assert.match(discovery,/data-discovery-search/);
  assert.match(discovery,/data-discovery-calendars/);
  assert.match(discovery,/data-discovery-summary/);
  assert.match(discovery,/disabled aria-disabled="true"/);
  assert.match(discoveryScript,/indicativeSelection/);
  assert.match(discoveryScript,/localPreview\?'http:\/\/127\.0\.0\.1:4328\/availability'/);
  assert.match(discoveryScript,/PUBLIC_BOOKING_READ_ONLY_ENABLED\?\?/);
  assert.match(discoveryScript,/PUBLIC_BOOKING_STAGING_READ_ONLY_ENABLED\)==='true'/);
  assert.match(discoveryScript,/hostedReadOnlyEnabled\?\(import\.meta\.env\.PUBLIC_BOOKING_AVAILABILITY_URL\?\?null\):null/);
  assert.match(discoveryScript,/if\(!availabilityUrl\)\{clearMasterAvailability\(\);return false;\}/);
  // The new journey can submit only with explicit approval and verification.
  assert.match(discoveryScript,/PUBLIC_BOOKING_REQUESTS_APPROVED==='true'/);
  assert.match(discoveryScript,/PUBLIC_BOOKING_AUTHORITATIVE_QUOTES_ENABLED==='true'/);
  assert.match(discoveryScript,/PUBLIC_BOOKING_TURNSTILE_SITE_KEY/);
  // Production submit activation requires an independent, exact request API;
  // the authoritative read-only quote API must remain available as well.
  assert.ok(discoveryScript.includes("bookingApi==='https://c7x0ongl4d.execute-api.eu-west-2.amazonaws.com'"));
  assert.ok(discoveryScript.includes("quoteOnlyEnabled&&liveQuoteEnabled&&productionRequestApi"));
  assert.ok(!discoveryScript.includes("Boolean(bookingApi)&&!quoteOnlyEnabled"));
  assert.ok(discoveryScript.includes("bookingApi+'/requests'"));
  // The preview button is inert by default, but must become a real submit control
  // when the explicitly approved request feature is enabled.
  assert.match(discovery,/type="button" class="button discover-request" disabled aria-disabled="true"/);
  assert.ok(discoveryScript.includes("confirmButton.type='submit'"));
  assert.ok(discoveryScript.includes("confirmButton.setAttribute('aria-disabled','false')"));
  assert.ok(discoveryScript.includes("if(requestEnabled&&!syntheticRequestEnabled&&confirmButton)"));
  assert.ok(discoveryScript.includes("confirmButton.textContent='Submit reservation request';"));
  assert.ok(!discoveryScript.includes("confirmButton.textContent=controlledOwnerTest?"));
  assert.ok(discoveryScript.includes("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"));

  assert.doesNotMatch(discoveryScript,/x-lesbuttes-staging-token|STAGING_API_TOKEN/);
  assert.match(discovery,/data-preview-guest-details/);
  assert.match(discovery,/name="email"/);
  assert.match(discovery,/disabled aria-disabled="true"/);
  assert.doesNotMatch(discovery,/data-api=/);
  // Validation is now allowed, but preview submission must still be prevented.
  assert.match(discoveryScript,/detailsForm.addEventListener\('submit',async event=>/);
  assert.match(discoveryScript,/if\(!requestEnabled&&confirmButton\)confirmButton.disabled=true/);
  assert.ok(discoveryScript.includes("response.status!==(syntheticRequestEnabled?201:202)"));
  assert.ok(discoveryScript.includes("window.location.hostname==='d123fnjf47zmyp.cloudfront.net'"));
  assert.match(discoveryScript,/await checkAuthoritativeQuote\(\)/);
  // Numeric GBP totals must be accepted; a double-escaped digit class rejects every quote.
  assert.ok(!discoveryScript.includes(String.raw`/^\\\\d+`));
  assert.ok(discoveryScript.includes(String.raw`/^\d+(?:\.\d{1,2})?$/`));

  assert.match(discovery,/type="email" name="email"[^>]*required/);
  assert.match(discovery,/type="tel" name="telephone"[^>]*pattern=[^>]*required/);
  assert.equal((discovery.match(/data-booking-step=/g)??[]).length,3);
  assert.match(discovery,/>booking terms<\/a>/);
  assert.doesNotMatch(discovery,/booking terms \(LB-DIRECT-2027-01\)/);
  assert.ok(discoveryScript.includes("termsVersion:'LB-DIRECT-2027-01'"));
  assert.ok(discoveryScript.includes("privacyVersion:'LB-PRIVACY-2027-01'"));
  assert.doesNotMatch(page,/data-mode="live"|booking-form/);
  assert.match(deployment,/PUBLIC_BOOKING_TURNSTILE_SITE_KEY: '0x4AAAAAAF7u2N5Mlj1-UsnQ'/);
  assert.match(deployment,/PUBLIC_BOOKING_REQUESTS_ENABLED: 'false'/);
  assert.match(deployment,/PUBLIC_BOOKING_REQUESTS_APPROVED: 'false'/);
  // Client-inserted rows do not have Astro's scope attribute; keep selectors global.
  assert.match(discovery,/\.discover-summary-lines :global\(\.summary-line\)/);
  assert.match(discovery,/\.discover-calendar-grids :global\(\.calendar-days button\)/);
  // Preview dates must be human-readable and use explicit UTC to avoid TZ off-by-one.
  assert.match(discoveryScript,/\.formatRange\(/);
  assert.match(discoveryScript,/timeZone:'UTC'/);

  assert.ok(!sitemap.includes("'/book/'"));
  assert.ok(!header.includes('href:"/book/"'));
  const languages=readFileSync(new URL('../../../src/pages/[lang]/book/index.astro',import.meta.url),'utf8');
  assert.match(languages,/\['nl','fr'\]/);
  assert.ok(!JSON.stringify(publicData).includes('ics?t='));
  assert.ok(!JSON.stringify(publicData).includes('STAGING_API_TOKEN'));
});

test('private staging occupancy reference is no-PII, uses exclusive checkout dates and protects held direct dates',()=>{
  const data=JSON.parse(readFileSync(new URL('../../../src/data/booking-occupancy-snapshot-2027.json',import.meta.url),'utf8'));
  assert.equal(data.mode,'DATED_REFERENCE_OCCUPANCY_NOT_LIVE');
  assert.equal(data.firstNight,'2027-03-20');
  assert.equal(data.lastNight,'2027-10-01');
  assert.equal(data.blocked.geranium.length,3);
  assert.equal(data.blocked.honeysuckle.length,4);
  const days=(ranges)=>ranges.reduce((sum,b)=>sum+(dateNumber(b.to)-dateNumber(b.from))/86400000,0);
  assert.equal(days(data.blocked.geranium),21);
  assert.equal(days(data.blocked.honeysuckle),28);
  assert.ok(data.blocked.geranium.some(x=>x.from==='2027-08-28'&&x.to==='2027-09-04'));
  assert.ok(data.blocked.honeysuckle.some(x=>x.from==='2027-08-28'&&x.to==='2027-09-04'));
  assert.doesNotMatch(JSON.stringify(data),/guestName|guestEmail|paymentReference|calendarToken|airbnb\.com\/calendar\/ical/i);
  const exporter=readFileSync(new URL('../export-availability-snapshot.mjs',import.meta.url),'utf8');
  assert.match(exporter,/env!=='staging'/);
  assert.match(exporter,/ConsistentRead:true/);
  assert.match(exporter,/ProjectionExpression:'PK, SK, expiresAt'/);
  assert.doesNotMatch(exporter,/(TransactWriteCommand|PutCommand|UpdateCommand|DeleteCommand)/);
});

test('compact calendar uses two adjacent months and exact branded selection colours',()=>{
  const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
  const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
  assert.match(page,/\.calendar-two-months/);
  assert.match(page,/#bed4c3/i);
  assert.match(page,/\.is-checkin/);
  assert.match(page,/\.is-checkout/);
  assert.match(page,/\.is-blocked/);
  assert.match(script,/shownMonths=\[month,monthShift\(month,1\)\]/);
  assert.match(script,/setMasterAvailability\(data\)/);
  assert.match(script,/clearMasterAvailability\(\)/);
});
test('local master bridge binds only loopback, enforces staging table, and has no guest data or write handlers',()=>{
  const script=readFileSync(new URL('../preview-master-server.mjs',import.meta.url),'utf8');
  assert.match(script,/HOST='127\.0\.0\.1',PORT=4328/);
  assert.match(script,/environment!=='staging'/);
  assert.match(script,/req\.method!=='GET'/);
  assert.match(script,/req\.url!=='\/availability'/);
  assert.match(script,/ORIGINS\.has\(origin\)/);
  assert.match(script,/masterOccupied/);
  assert.doesNotMatch(script,/TransactWriteCommand|UpdateCommand|PutCommand|DeleteCommand|SendEmailCommand/);
});

test('hidden booking journey has three steps with inline pricing and cannot confirm a booking',()=>{
  const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
  const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
  for(const n of [1,2,3])assert.match(page,new RegExp('data-booking-step="'+n+'"'));
  assert.doesNotMatch(page,/data-booking-step="4"/);
  assert.match(page,/data-journey-indicator/);
  assert.match(page,/data-discovery-search/);
  assert.match(page,/data-discovery-options/);
  assert.match(page,/data-discovery-summary/);
  assert.match(page,/data-preview-guest-details/);
  assert.match(page,/discover-calendar-price-layout/);
  assert.match(page,/data-continue-details disabled/);
  assert.match(page,/data-continue-details/);
  assert.match(page,/data-back-to-filter/);
  assert.match(page,/data-back-to-cottages/);
  assert.doesNotMatch(page,/data-back-to-review/);
  assert.match(page,/data-journey-selection/);
  assert.match(script,/setStep\(2\)/);
  assert.match(script,/setStep\(3\)/);
  assert.doesNotMatch(script,/setStep\(4\)/);
  assert.match(script,/getQuote\(\)/);
  assert.match(script,/await refreshMaster\(\)/);
  assert.doesNotMatch(script,/sessionStorage|localStorage|navigator\\.sendBeacon/);
  assert.match(script,/if\(!requestEnabled&&confirmButton\)confirmButton.disabled=true/);
  assert.match(script,/await checkAuthoritativeQuote\(\)/);
  assert.match(page,/data-preview-guest-details[^>]*autocomplete="off"/);
  assert.match(page,/disabled aria-disabled="true"/);
});


test('owner-only £1 acceptance requires explicit URL and private code; normal site flags remain disabled',()=>{
 const discovery=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../../../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.match(discovery,/PUBLIC_BOOKING_CONTROLLED_TEST_ENABLED==='true'/);
 assert.match(discovery,/get\('owner-test'\)==='payment-email-2027'/);
 assert.match(discovery,/testAccessCode:oneTimeAccess/);
 assert.match(discovery,/choice!=='geranium'/);
 assert.match(discovery,/mike@un1ty\.gg/);
 assert.match(workflow,/PUBLIC_BOOKING_REQUESTS_ENABLED: 'false'/);
 assert.match(workflow,/PUBLIC_BOOKING_REQUESTS_APPROVED: 'false'/);
 assert.match(workflow,/PUBLIC_BOOKING_CONTROLLED_TEST_ENABLED: 'true'/);
});


test('search stage uses a single two-click calendar instead of two native date pickers',()=>{
 const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const translations=readFileSync(new URL('../../../src/lib/booking-discovery-copy.ts',import.meta.url),'utf8');
 assert.match(page,/data-range-trigger/);
 assert.match(page,/data-range-picker/);
 assert.match(page,/data-range-months/);
 assert.match(page,/role="dialog" aria-modal="false"/);
 assert.match(page,/type="hidden" name="arrival"/);
 assert.match(page,/type="hidden" name="departure"/);
 assert.doesNotMatch(page,/type="date" name="(?:arrival|departure)"/);
 assert.ok(script.includes('function renderRangePicker()'));
 assert.ok(script.includes('async function selectSearchRangeDate(date:string)'));
 assert.ok(script.includes('eligibleSearchUnits().some(unit=>possibleNight(unit,date))'));
 assert.ok(script.includes('eligibleSearchUnits().some(unit=>canPickCheckout(unit,start,end))'));
 assert.ok(script.includes('if(rangePendingStart&&date>rangePendingStart&&canFinishSearchRange(rangePendingStart,date))'));
 assert.ok(script.includes('const connected=await refreshMaster()'));
 assert.ok(script.includes('if(advance&&(!arrival.value||!departure.value))'));
 assert.ok(script.includes('new URLSearchParams({unit:choice,start:arrival.value,end:departure.value'));
 assert.ok(script.includes("if(event.key==='Escape'&&!rangePicker.hidden)"));
 assert.ok(page.includes('.search-range-picker[hidden]{display:none!important}'));
 assert.ok(page.includes('@media(max-width:44rem){.search-range-months{grid-template-columns:1fr}'));
 for(const label of ['Select your dates','Kies uw data','Choisissez vos dates'])
   assert.ok(translations.includes(label));
});

test('booking journey uses an Edit search pill, hides test copy and retains live validation',()=>{
 const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const copy=readFileSync(new URL('../../../src/lib/booking-discovery-copy.ts',import.meta.url),'utf8');
 assert.match(page,/class="journey-edit-search-button"[^>]*data-back-to-filter/);
 assert.match(page,/journey-stage-heading-with-action/);
 assert.match(page,/margin-left:auto/);
 assert.doesNotMatch(page,/class="discover-snapshot-note"/);
 assert.doesNotMatch(page,/class="discover-preview-note" role="note"/);
 assert.doesNotMatch(page,/\{t\.previewNoSubmit\}/);
 for(const forbidden of ['OWNER PAYMENT EMAIL TEST','OWNER EMAIL TEST ONLY',
  'Price calculated from the published booking database.',
  'Availability from the booking master at the time displayed.']){
  assert.ok(!page.includes(forbidden)&&!script.includes(forbidden),forbidden);
 }
 assert.match(copy,/direct:'Price'/);
 assert.match(copy,/direct:'Prijs'/);
 assert.match(copy,/direct:'Prix'/);
 assert.match(script,/fill\('\[data-summary-direct\]',money\(Number\(authoritativeQuote\.totalGBP\)\)\)/);
 assert.match(script,/quote\.meetsDraftMinimum\?'':tr\('tooShort'\)/);
 assert.match(script,/reviewNext\.disabled=!masterConnected\(\)\|\|!q\|\|!q\.meetsDraftMinimum/);
 assert.match(script,/checkAuthoritativeQuote\(\)\.then/);
 assert.match(script,/controlledOwnerTest/);
});

test('calendar and price appear alongside one another with direct progression to guest details',()=>{
 const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const layout=page.indexOf('class="discover-calendar-price-layout"');
 const calendar=page.indexOf('data-discovery-availability',layout);
 const price=page.indexOf('data-discovery-summary',layout);
 const details=page.indexOf('data-booking-step="3"',layout);
 assert.ok(layout>=0&&calendar>layout&&price>calendar&&details>price);
 assert.match(page,/grid-template-columns:minmax\(0,1\.8fr\) minmax\(17rem,\.82fr\)/);
 assert.match(page,/@media\(max-width:62rem\)/);
 assert.doesNotMatch(page,/data-continue-review|data-back-to-review/);
 assert.ok(script.includes("onClick('[data-continue-details]',async()=>{"));
 assert.match(script,/setStep\(3\)/);
 assert.match(script,/await checkAuthoritativeQuote\(\)/);
});

test('Turnstile starts on guest details and restricted owner failures are explained',()=>{
 const src=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 assert.match(src,/if\(step===3\)activateChallenge\(\)/);
 assert.match(src,/activateChallenge=\(\)=>\{/);
 assert.match(src,/'expired-callback'/);
 assert.match(src,/Verification was rejected or your restricted test access is no longer valid/);
 assert.match(src,/This one-time owner booking test has already been used/);
 assert.match(src,/BOOKING_REQUESTS_APPROVED==='true'/);
 assert.match(src,/const token=syntheticRequestEnabled/);
});

test('successful request replaces guest form with clear branded confirmation and reference',()=>{
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
 assert.match(script,/heading\.textContent='Request received'/);
 assert.match(script,/progress\.textContent='Request received'/);
 assert.match(script,/detailsForm\.replaceChildren\(\)/);
 assert.match(script,/journey-request-reference/);
 assert.match(script,/No payment has been taken/);
 assert.doesNotMatch(script,/mark.textContent='✓'/);
 assert.match(page,/journey-request-success h3/);
 assert.match(page,/journey-request-reference-label/);
});

test('booking discovery does not show internal calendar verification narrative',()=>{
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const copy=readFileSync(new URL('../../../src/lib/booking-discovery-copy.ts',import.meta.url),'utf8');
 assert.doesNotMatch(script,/tr\('liveDisclaimer'\)/);
 assert.doesNotMatch(copy,/Dates were checked against the booking master/);
 assert.doesNotMatch(copy,/We also verify Airbnb before accepting any request/);
});

test('live guest pricing hides indicative rates, public timestamp and brand-specific comparisons',()=>{
 const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
 const copy=readFileSync(new URL('../../../src/lib/booking-discovery-copy.ts',import.meta.url),'utf8');
 assert.match(script,/summaryLines.hidden=liveQuoteEnabled/);
 assert.doesNotMatch(script,/tr\('liveMaster'\)/);
 assert.match(copy,/airbnb:'Hosting site comparison'/);
 assert.match(copy,/direct:'Total stay price'/);
 assert.doesNotMatch(copy,/Airbnb calendar equivalent|Booking master checked at/);
 assert.match(script,/termsVersion:'LB-DIRECT-2027-01'/);
});
