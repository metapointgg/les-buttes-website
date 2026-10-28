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
  const script=readFileSync(new URL('../../../src/scripts/booking-form.ts',import.meta.url),'utf8');
  const sitemap=readFileSync(new URL('../../../src/pages/sitemap.xml.ts',import.meta.url),'utf8');
  const header=readFileSync(new URL('../../../src/components/Header.astro',import.meta.url),'utf8');
  assert.match(page,/PUBLIC_BOOKING_REQUESTS_ENABLED==='true'/);
  assert.match(page,/noindex>/);
  const discovery=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
  const discoveryScript=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
  assert.match(page,/<BookingDiscoveryPreview\/>/);
  assert.match(discovery,/data-discovery-search/);
  assert.match(discovery,/data-discovery-calendars/);
  assert.match(discovery,/data-discovery-summary/);
  assert.match(discovery,/disabled aria-disabled="true"/);
  assert.match(discoveryScript,/indicativeSelection/);
  assert.match(discoveryScript,/localPreview\?'http:\/\/127\.0\.0\.1:4328\/availability'/);
  assert.match(discoveryScript,/PUBLIC_BOOKING_STAGING_READ_ONLY_ENABLED==='true'/);
  assert.match(discoveryScript,/hostedReadOnlyPath='\/api\/staging\/availability'/);
  assert.match(discoveryScript,/if\(!availabilityUrl\)\{clearMasterAvailability\(\);return false;\}/);
  assert.doesNotMatch(discoveryScript,/\/requests['`]/); // never send a booking request
  assert.doesNotMatch(discoveryScript,/x-lesbuttes-staging-token|STAGING_API_TOKEN/);
  assert.match(discovery,/data-preview-guest-details/);
  assert.match(discovery,/name="email"/);
  assert.match(discovery,/disabled aria-disabled="true"/);
  assert.doesNotMatch(discovery,/data-api=/);
  // Validation is now allowed, but preview submission must still be prevented.
  assert.ok(discoveryScript.includes("detailsForm.addEventListener('submit',event=>{event.preventDefault();validateContact();})"));
  assert.match(discovery,/type="email" name="email"[^>]*required/);
  assert.match(discovery,/type="tel" name="telephone"[^>]*pattern=/);
  assert.match(page,/data-mode="live"/);
  assert.match(script,/if\(form\.dataset\.mode==='preview'\)/);
  assert.match(script,/previewBookingQuote/);
  // Client-inserted rows do not have Astro's scope attribute; keep selectors global.
  assert.match(discovery,/\.discover-summary-lines :global\(\.summary-line\)/);
  assert.match(discovery,/\.discover-calendar-grids :global\(\.calendar-days button\)/);
  // Preview dates must be human-readable and use explicit UTC to avoid TZ off-by-one.
  assert.match(script,/\.formatRange\(/);
  assert.match(script,/timeZone:'UTC'/);

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

test('hidden booking journey has four separate navigable steps and cannot confirm a booking',()=>{
  const page=readFileSync(new URL('../../../src/components/BookingDiscoveryPreview.astro',import.meta.url),'utf8');
  const script=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
  for(const n of [1,2,3,4])assert.match(page,new RegExp('data-booking-step="'+n+'"'));
  assert.match(page,/data-journey-indicator/);
  assert.match(page,/data-discovery-search/);
  assert.match(page,/data-discovery-options/);
  assert.match(page,/data-discovery-summary/);
  assert.match(page,/data-preview-guest-details/);
  assert.match(page,/data-continue-review disabled/);
  assert.match(page,/data-continue-details/);
  assert.match(page,/data-back-to-filter/);
  assert.match(page,/data-back-to-cottages/);
  assert.match(page,/data-back-to-review/);
  assert.match(page,/data-journey-selection/);
  assert.match(script,/setStep\(2\)/);
  assert.match(script,/setStep\(3\)/);
  assert.match(script,/setStep\(4\)/);
  assert.match(script,/getQuote\(\)/);
  assert.match(script,/await refreshMaster\(\)/);
  assert.doesNotMatch(script,/sessionStorage|localStorage|navigator\.sendBeacon|\/requests['`]/);
  assert.match(page,/data-preview-guest-details[^>]*autocomplete="off"/);
  assert.match(page,/disabled aria-disabled="true"/);
});
