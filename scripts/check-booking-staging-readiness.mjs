// Staging-readiness guard: do not mistake a successful static build for live availability.
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const page=readFileSync('src/components/BookingRequestPage.astro','utf8');
const discovery=readFileSync('src/scripts/booking-discovery.ts','utf8');
assert.match(page,/PUBLIC_BOOKING_REQUESTS_ENABLED==='true'/,'Guest submissions must remain explicitly gated');
assert.match(page,/Boolean\(apiUrl&&turnstileKey\)/,'Guest submissions require API and Turnstile configuration');
assert.match(discovery,/if\(!localPreview\)\{clearMasterAvailability\(\);return false;\}/,'Hosted preview must not silently use local availability');
assert.match(discovery,/127\.0\.0\.1:4328\/availability/,'Local master bridge must remain explicit');
for(const language of ['','fr/','nl/']){
  const output='dist/'+language+'book/index.html';
  assert.ok(existsSync(output),'Missing booking page: '+output);
  const html=readFileSync(output,'utf8');
  assert.doesNotMatch(html,/data-mode=["']live["']/i,'Live booking form unexpectedly present: '+output);
  assert.doesNotMatch(html,/data-booking-form(?:\\s|>)/i,'Submission form unexpectedly present: '+output);
  assert.match(html,/<meta[^>]*name=["']robots["'][^>]*noindex|<meta[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i,'Booking preview must remain noindex: '+output);
}
console.log('Staging readiness: static booking pages verified in EN/FR/NL.');
console.log('Staging readiness: guest submission is gated; hosted master availability is NOT connected.');
console.log('Staging readiness: a separate authenticated, read-only availability endpoint is required before end-to-end hosted testing.');
