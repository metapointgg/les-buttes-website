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
3. **Date-based calendar:** each month shows weekday headings, *reference-snapshot* occupied nights, and the **recorded Airbnb nightly rate** for potentially available nights. Click an arrival and a checkout date; checkout is excluded from occupied nights, so same-day changeovers are possible. Date ranges with a known booking, outside the season, or over 27 nights cannot be used.
4. **Price summary:** after a valid reference-available selection, displays cottage-by-cottage indicative split-savings price, Airbnb calendar comparison and possible guest saving. The **3/5/7-night minimums are draft**; a too-short stay is flagged.
5. **Request to reserve:** visible but **disabled during private preview**, with a clear statement that requests, guest-data collection, live availability checks and payments are not enabled.
6. **Multilingual and responsive:** English, Dutch and French, mobile-friendly cottage cards and calendar layout.

### Availability source and safe snapshot refresh

A dated, **no-PII** occupancy snapshot at `src/data/booking-occupancy-snapshot-2027.json` contains the known 2027 reservations already reconciled with the staging master: Geranium May 22–29 and June 19–26; Honeysuckle June 12–19, July 31–August 7 and August 14–21; **both** cottages August 28–September 4 (existing direct/RESERVED). Blocked ranges are `[from,to)`, with checkout excluded.

For a fresh reference **only after checking the booking account and table**, use the owner-only read-only exporter from the repository root:

```powershell
$env:AWS_PROFILE = "default"
$env:AWS_REGION = "eu-west-2"
$env:BOOKING_ENVIRONMENT = "staging"
$env:BOOKINGS_TABLE = "les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK"
node services/booking-api/export-availability-snapshot.mjs
```

This queries the **existing staging master date slots** with consistent reads, excludes expired request holds, and writes **only blocked night date ranges and a capture timestamp** to the local JSON file. It **never mutates AWS reservations** or exposes guest names, booking references, private iCalendar URLs or credentials. If the table appears wrong or zero occupied nights are returned for either cottage, it refuses to write a possibly misleading snapshot. Review the generated JSON before sharing a branch or promoting any changes. The webpage remains a snapshot, and future bookings can make it stale instantly.

**Do not call unblocked dates “available” without qualification.** All results are **potential** matches until the master AND Airbnb calendars are queried at the time a reservation is submitted. There is no public-safe live availability API connected to the hidden preview; the existing staging API requires a token that **must not be embedded in browser code**.

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

Static review-only prices: `src/data/booking-preview-2027.json`; dated occupied-night snapshot: `src/data/booking-occupancy-snapshot-2027.json`.
Pure browser quote calculator: `src/lib/booking-preview.ts`; filter/availability-snapshot rules: `src/lib/booking-discovery.ts`.
Shared localised discovery copy: `src/lib/booking-discovery-copy.ts`.
Discovery page: `src/components/BookingDiscoveryPreview.astro` and `src/scripts/booking-discovery.ts`. The future live request form remains isolated in `BookingRequestPage.astro` / `booking-form.ts` behind the explicit activation flag.
Tests: `services/booking-api/test/website-preview.test.mjs` checks preview invariants and does not expose the live API, while `src/test/booking-discovery.test.mjs` exercises the actual TypeScript search and occupancy-snapshot logic using the website's build dependencies.

No AWS deployment is needed to test this front-end preview.
