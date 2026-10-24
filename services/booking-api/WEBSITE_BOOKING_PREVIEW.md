# Hidden website booking experience — private review (2027)

**Status:** implemented in DRAFT PR #41 for local review. NOT published to the main website, NOT password-protected, NOT accepting booking requests or collecting payment.

## Preview the new visitor journey

From the website repository on Windows:

```powershell
cd C:\ProjectsGit\les-buttes-website
git switch feature/direct-booking-requests-27-night
git pull --ff-only
npm run test
npm run dev
```

Open:
- English: `http://localhost:4321/book/`
- Dutch: `http://localhost:4321/nl/book/`
- French: `http://localhost:4321/fr/book/`

The routes exist **only on the PR branch until it is merged**. They are also marked `noindex`, absent from the sitemap and have no navigation/footer/cottage-page CTA links. **Noindex and unlinked routes are discoverability controls, not access controls.** If a private *internet-hosted* preview is later wanted, use an authenticated preview host (e.g. CloudFront access protection), not the production domain with a secret URL.

### What can be tested now

1. **Select cottages:** Geranium (4 guests), Honeysuckle (6), or both (10); the guest maximum updates as the selection changes.
2. **Choose dates:** From **20 March 2027**, checking out no later than **2 October 2027**; no more than 27 nights. Invalid dates or guest numbers show inline feedback.
3. **See a quote preview:** Browser locally calculates the Airbnb monthly calendar subtotal using the **24 October 2026 fee-adjusted nightly prices**, then an **indicative** split-savings direct total: about 11% lower, rounded separately per cottage to £50 for weeks (or £25 for shorter stays). A 28 August–4 September 2027 combined preview shows **Geranium £1,450 + Honeysuckle £1,650 = £3,100**, compared with £3,475 on the Airbnb calendar, exactly mirroring the owner-agreed previous quote.
4. **Read the draft minimum stay:** Proposed seasonal 3/5/7 nights are displayed as a warning, not as confirmed live policy. Stays crossing a boundary use the strictest minimum.
5. **Review what happens next:** A section explains future owner checks, terms and full SumUp payment. It offers links to the regular cottages/Airbnb pages and the regular contact page.

**There is no live availability check in preview.** The browser does not fetch from the existing staging API, which requires a private staging token; exposing that token in a public website would be unsafe. No booking is created and no dates are held. Historic Airbnb snapshot rates may become stale. The website never asks for guest name, email or payment details in preview; it stores nothing, sends nothing and cannot call `/requests`.

### Hidden until explicitly approved

- The production site is still deployed **only** on pushes to `main`; PR #41 remains draft.
- `/book/`, `/nl/book/`, `/fr/book/` are **not** linked from the existing "Check availability" CTAs. Those continue to the cottages and Airbnb.
- A configured API URL or Turnstile site key alone **cannot** activate the guest request form. Live mode requires explicit `PUBLIC_BOOKING_REQUESTS_ENABLED=true` at website **build time**, along with `PUBLIC_BOOKING_API_URL` and `PUBLIC_TURNSTILE_SITE_KEY`. **Do not set this flag**, merge, or deploy production until all acceptance gates are complete.
- Keeping preview mode unlisted is not a suitable substitute for full access control. The correct next step for a remote demonstration is an authenticated staging distribution, not a public launch.

### Next technical decisions before guest submissions

- Approve 2027 *final* monthly/holiday nightly rates, date-based minimum stay periods and consistent display of negotiated direct savings. Do not publish snapshot calculations as guaranteed final prices.
- Approve Guernsey-aware guest terms, exact cancellation/refund cutoff times, privacy/controller details and versioned guest terms acceptance.
- Complete a publicly accessible **production** availability API with appropriate CORS and security controls, independently reconciled with Airbnb. The **existing staging API must never have its private header token embedded in client JavaScript**.
- Define price override/acceptance and fulfilment flows so the guest's agreed direct quote is independently approved in DynamoDB and the SumUp link amount matches, before verification and final confirmation.
- Perform real card payment, refund, owner notification, guest email and outgoing calendar subscription acceptance tests; verify no double bookings.
- Add final production noindex removal and direct booking CTAs **only with explicit owner approval**.

### Data and regression tests

Static review-only JSON: `src/data/booking-preview-2027.json`.
Pure browser calculator: `src/lib/booking-preview.ts`.
Shared localised copy: `src/lib/booking-preview-copy.ts`.
Form/controller: `src/components/BookingRequestPage.astro` and `src/scripts/booking-form.ts`.
Unit tests: `services/booking-api/test/website-preview.test.mjs` compare every 2027 preview rate with the captured Airbnb host rates, verify the £3,100 original week and guard noindex/hidden/submission conditions.

No AWS deployment is needed to test this front-end preview.
