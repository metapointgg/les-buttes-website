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

### What can be tested now — cottage discovery and date selection

1. **Search filters:** optional arrival/checkout dates, adults (at least one), children (0+), **bedrooms needed**, and either best-matching accommodation or explicitly **both cottages**. Geranium has **2 bedrooms / sleeps 4**; Honeysuckle has **3 bedrooms / sleeps 6**. Parties of 7–10 or requests for 4–5 bedrooms automatically require **both**.
2. **Matching cottage cards:** image-led Geranium and Honeysuckle result cards. A chosen single-cottage option opens its calendar. When two cottages are needed or explicitly selected, show **two adjacent calendars**.
3. **Date-based calendar:** the compact picker shows **two months side by side**, with master-occupied nights grey, unblocked nights white, and a highlighted range. Exact nightly Airbnb comparison rates remain in the quote model, with date-level rates available to accessibility labels. Click an arrival and a checkout date; checkout is excluded from occupied nights, so same-day changeovers are possible. Date ranges with a known booking, outside the season, or over 27 nights cannot be used.
4. **Price summary:** after a valid reference-available selection, displays cottage-by-cottage indicative split-savings price, Airbnb calendar comparison and possible guest saving. The **3/5/7-night minimums are draft**; a too-short stay is flagged.
5. **Request to reserve:** visible but **disabled during private preview**, with a clear statement that requests, guest-data collection, live availability checks and payments are not enabled.
6. **Multilingual and responsive:** English, Dutch and French, mobile-friendly cottage cards and calendar layout.

### LIVE staging-master calendar in the private local preview

**The hidden booking page now uses a read-only local master bridge, not the old dated occupancy snapshot.** This bridge reads only `UNIT#geranium` and `UNIT#honeysuckle` date slots from the existing staging DynamoDB table, with **strongly consistent reads** and the same expiry rule used by the booking API. The browser receives only occupied date ranges and a timestamp; it never sees guest names, booking IDs, AWS credentials, SSM secrets or Airbnb iCal tokens.

Use TWO PowerShell terminals from the website repository. **Terminal 1 — start the safe local bridge (once):**

```powershell
cd C:\ProjectsGit\les-buttes-website
$env:AWS_PROFILE = "default"
$env:AWS_REGION = "eu-west-2"
$env:BOOKING_ENVIRONMENT = "staging"
$env:BOOKINGS_TABLE = "les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK"
npm --prefix services/booking-api install
node services/booking-api/preview-master-server.mjs
```

The bridge listens **only on `127.0.0.1:4328`**, checks the HTTP Host and only permits browser CORS origins `http://localhost:4321` and `http://127.0.0.1:4321`. Only `GET /availability` is implemented. There are **no write, reservation, user-data or payment handlers**. The bridge requires an explicitly named **staging** table and cannot start when configured for production. The `AWS_PROFILE` environment setting is used server-side only.

**Terminal 2 — website preview:**

```powershell
cd C:\ProjectsGit\les-buttes-website
git pull --ff-only
npm run test:booking
npm run test:discovery
npm run dev
```

Open `http://localhost:4321/book/`. The page requests fresh read-only master data when loading, searching, changing months or choosing dates. **White** means there is no blocked master slot at the time of the read; **grey** means occupied/closed/unknown; **green** means selected check-in and checkout; **#BED4C3** fills the dates between. There are **two smaller months side by side for each cottage**; when both cottages are selected, each cottage gets its own two-month row. The checkout date itself is not occupied.

**If the bridge is stopped, network permission is denied, or DynamoDB cannot be reached, the UI fails closed: days are grey/unselectable, no quote can be generated, and the page reports that live master availability is offline.** A local file or the old snapshot is never substituted as live availability. Prices are still **indicative** and drawn from October 2026 host-calendar rates. The holiday season/minimum stay periods are still proposals, and any direct stay must be independently checked against Airbnb before owner approval.

**Security boundaries:** Do NOT change the bridge listener to `0.0.0.0`, deploy this server, commit AWS credentials, or expose the staging API token in browser JavaScript. This is deliberately a **local prototype**, NOT a public production availability API. No existing AWS infrastructure must be redeployed to test it.

### Legacy snapshot (reference only)

The existing `src/data/booking-occupancy-snapshot-2027.json` and `export-availability-snapshot.mjs` still exist for historic comparison and no-PII audits, but the new hidden browser calendar does **not** fall back to them when the live read fails. They are never authoritative for live bookability.

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

Static review-only prices: `src/data/booking-preview-2027.json`; historic occupied-night snapshot: `src/data/booking-occupancy-snapshot-2027.json` (NOT used as fallback).
Pure browser quote calculator: `src/lib/booking-preview.ts`; filter/availability-snapshot rules: `src/lib/booking-discovery.ts`.
Shared localised discovery copy: `src/lib/booking-discovery-copy.ts`.
Discovery page: `src/components/BookingDiscoveryPreview.astro` and `src/scripts/booking-discovery.ts`. The future live request form remains isolated in `BookingRequestPage.astro` / `booking-form.ts` behind the explicit activation flag.
Tests: `services/booking-api/test/master-occupied.test.mjs` validates read-only master slot projection; `services/booking-api/test/website-preview.test.mjs` protects no-booking-write controls; `src/test/booking-discovery.test.mjs` exercises date selection, capacity and fail-closed live-master validation.

No AWS deployment is needed to test this front-end preview.
