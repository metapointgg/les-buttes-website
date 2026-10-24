# Les Buttes direct booking requests — implementation draft

**Not live, not production-ready. Do not switch on customer submissions until the acceptance checklist below is completed.**

This is a deliberately small request-to-book system for **Geranium, Honeysuckle or both**. The main Les Buttes Astro website remains static on S3/CloudFront and reuses a single booking page template in English, Dutch and French. Public routes: `/book/`, `/nl/book/`, `/fr/book/`. They show a disabled preview and direct visitors to existing Airbnb booking links until the environment is configured. The feature branch is separate from the production deployment workflow.

## Confirmed 2027 availability window

On **24 October 2026**, the host confirmed that **both Geranium and Honeysuckle are available for holiday guest arrivals from Saturday 20 March 2027**. No winter tenant remains booked into the holiday season. The existing staging rule already opens both cottages on `2027-03-20`; **do not introduce an April reopening for Geranium**.

The current proposed end-of-season checkout is **Saturday 2 October 2027** (last occupied night `2027-10-01`). This matches the staging season rules but is distinct from the confirmed March opening. The 3/5/7-night season bands and nightly GBP rates remain subject to final host approval. Historical winter closure date blocks shown by Airbnb end **before** 20 March and should not be imported as extra future seasonal blocks in staging. The master has already been reconciled for the 2027 in-season periods.

## Proposed Option B 2027 prices and minimum stays — not approved

A **full nightly-rate and minimum-stay calendar** is available for review at [PRICING_REVIEW_2027.md](PRICING_REVIEW_2027.md) and machine-readable [config/proposed-2027-reviewed-option-b.json](config/proposed-2027-reviewed-option-b.json). The proposal covers **all 196 nights** from 20 March to 1 October, with seven 3/5/7-night stay bands and school-holiday price overlays on prior Option B. The proposal's approval flags are intentionally **not valid for staging or production quoting**. The deployed staging configuration remains synthetic.

The host has now supplied readable Airbnb calendar screenshots for **both** Geranium and Honeysuckle covering March–October 2027. The two machine-readable observed Airbnb nightly-price baselines are [Geranium](config/observed-airbnb-geranium-2027.json) and [Honeysuckle](config/observed-airbnb-honeysuckle-2027.json). Both are **NOT approved direct-booking rates**; the host says these calendar prices already include Airbnb's 2026 fee-adjustment uplift, so never add another uplift automatically. Both seven-night held-week prices exactly reproduce the original £1,630 / £1,845 Airbnb quotes. **Owner-confirmed pricing approach:** share Airbnb fee savings with direct guests and Les Buttes, following the **actual agreed 28 Aug–4 Sep 2027 direct guest prices of £1,450 Geranium and £1,650 Honeysuckle** against Airbnb £1,630 / £1,845. That is a combined **10.79%** saving for the guest. Use around 11% as a *manual quoting guide*, rounded to a sensible whole GBP figure per cottage, not as an automatically applied rate or discount. See [PRICING_REVIEW_2027.md](PRICING_REVIEW_2027.md) and [config/direct-pricing-approach-2027.json](config/direct-pricing-approach-2027.json).

No confirmed Airbnb or reserved off-Airbnb booking should be retrospectively repriced. In particular the 28 August–4 September two-cottage reservation retains its **agreed prices of £1,450 Geranium and £1,650 Honeysuckle**, and remains **direct / RESERVED**, pending final confirmation. No payment is inferred from this price agreement.

## Locked-in rules

- Guest check-in and checkout dates, 1 to **27 nights** (28+ nights must enquire separately).
- Capacities: Geranium 4, Honeysuckle 6, both cottages 10.
- Minimum stays are configured by dates, not hardcoded. Intended low/shoulder/peak minimums: 3/5/7 nights; **season cutover dates still require confirmation**.
- Seasonal open dates must be configured explicitly. Requests outside a configured open season are rejected.
- Every request **requires host approval**. No payment is requested at submission. The website displays a provisional quote based on explicitly configured nightly rates for both cottages.
- Hold the dates for 24 hours pending review; host approval extends the hold 48 hours while awaiting full payment.
- After reviewing the request, host creates a **SumUp payment link** for the agreed full price and sends it with booking terms. The guest has not booked until payment has been independently verified and the host marks it confirmed.
- **Cancellation terms remain NOT APPROVED.** The original Strict-policy assumption is obsolete for current Airbnb short stays. Proposed Guernsey-reviewed terms use a **Firm-style** 24h/30-day/7-day refund schedule; see [BOOKING_TERMS_DRAFT_2027.md](BOOKING_TERMS_DRAFT_2027.md). Do not request payment, auto-refund or enforce any draft terms until final owner/legal approval, explicit guest acknowledgement and operational verification.
- The master calendar exports held and confirmed nights in private no-PII .ics feeds for Airbnb to import. Airbnb calendar updates **are delayed**, so never approve an Airbnb request without checking the master calendar; when accepting Airbnb requests, enter a manual block first.
- A previously confirmed Airbnb reservation **always wins over a new direct request** and must be imported or blocked before enabling the direct channel.

## Backend

Directory `services/booking-api/` is an isolated Node.js 22 Lambda service. AWS SAM infra lives in `infra/booking-api/template.yaml`. It is **not automatically deployed by the website's existing GitHub Actions workflow**.

Public endpoints:

| Route | Purpose |
|---|---|
| `GET /health` | Status and whether accepting requests |
| `GET /availability?unit=geranium&start=2027-05-01&end=2027-05-08&guests=2` | Live availability after dates, cap and season rules |
| `POST /requests` | Captcha-verified, transactional hold and host notification |
| `GET /calendar/{random-calendar-token}/geranium.ics` | Import into Airbnb Geranium calendar |
| `GET /calendar/{random-calendar-token}/honeysuckle.ics` | Import into Airbnb Honeysuckle calendar |

DynamoDB stores one item per unavailable night per property and a separate private booking metadata item. A 27-night booking of both cottages uses 54 occupied-night records. A single DynamoDB transaction writes all slots and the request metadata, with conditions to prevent conflicting requests.

The `BOOKING_RULES_JSON` environment variable must include **both** an `openSeasons` list and contiguous `minimumStays` date ranges. The following is deliberately only a *conservative illustrative format*, NOT the intended Les Buttes season timetable:

```json
{
  "openSeasons": [{"start":"2027-03-20","end":"2027-10-01"}],
  "minimumStays": [{"start":"2027-03-20","end":"2027-10-01","nights":7}]
}
```

An `openSeasons` end date represents the **last occupied night**, not the departure day. Every requested night must be within a season and have a valid minimum-stay rule. Replace this illustration with actual confirmed 3/5/7-night periods before going live.

**Prices must also be explicitly configured.** `BOOKING_RATES_JSON` specifies **nightly GBP accommodation prices** by date and property. For a booking spanning rate periods, the engine sums each occupied night's rate. For both cottages, it sums the prices for each property. Ambiguous or uncovered nights cause a configuration error rather than a fabricated quote. **The following figures are placeholders for testing only, not 2027 Les Buttes rates:**

```json
{
  "status": "PROPOSED_ONLY_NOT_APPROVED",
  "periods": [
    {"start":"2027-03-20","end":"2027-06-30","geranium":100,"honeysuckle":120},
    {"start":"2027-07-01","end":"2027-10-01","geranium":140,"honeysuckle":160}
  ]
}
```

The API will **not** issue any guest quotes unless the rate configuration also contains `"status":"APPROVED_FOR_LIVE_BOOKINGS"`. Do not set this flag until all prices, bank holiday overlays, open dates and inclusions have been verified. The earlier proposed September 2026 Option B monthly rates are preserved as a **draft only** at `services/booking-api/config/proposed-2027-option-b.json`. That file is missing March rates and does not implement proposed holiday overlays. It is **not** deployed or active.

The host may vary the quoted amount only with an explicit recorded reason. Deposit, cleaning fees, taxes and discount codes are not implemented; the current quote assumes that configured nightly amounts are the full price of the accommodation. Check the figures and any statutory disclosures before launch.

Cloudflare Turnstile is required on public requests (free tier, externally hosted), and validated by the backend. Owner email notification is sent via SES when configured. The Lambda currently logs notification delivery failures; CloudWatch alarm/error review is required before launch.

## Guest direct-booking terms — DRAFT ONLY

A **Guernsey-aware, unapproved** guest terms draft now exists at [BOOKING_TERMS_DRAFT_2027.md](BOOKING_TERMS_DRAFT_2027.md). It covers contract formation, full SumUp payment after manual approval, the candidate Firm-style cancellation timetable, statutory protections, host cancellation, refund handling and privacy/permit/contracting-party sign-off. It is **not live**, is not a legal opinion, and must not be sent as final terms or used to take payment. Direct-booking approval/payment remains blocked operationally pending versioned guest acknowledgement and real merchant testing.

## Owner-only split-savings direct quote workflow (draft)

The confirmed manual quoting principle uses **the two 2027 Airbnb calendar screenshots as the comparison baseline** (fees already reflected) and aims for approximately 11% direct-guest savings, rounded per cottage and always subject to owner approval. This is **not an automatic guest discount**.

For a read-only local preview, run `node services/booking-api/preview-direct-quote.mjs both 2027-08-28 2027-09-04` at the repo root. It reproduces the agreed **£1,450 Geranium + £1,650 Honeysuckle = £3,100** example from Airbnb £1,630/£1,845, without reading or modifying AWS. For other dates it is merely an **indicative owner calculation** based on the Oct 2026 screenshot snapshot; it does not check availability, does not authorise final nightly prices and does not issue a guest quote. Full instructions in [OWNER_QUOTING.md](OWNER_QUOTING.md).

For the already-existing 28 Aug–4 Sep 2027 `direct / RESERVED` block, the admin command `record-direct-price ID geranium=1450 honeysuckle=1650` can store the negotiated amounts **on the existing booking metadata only**, if the host explicitly executes it after checking the record. No slot or payment statuses change, and the command refuses to overwrite an existing quote. See [OWNER_QUOTING.md](OWNER_QUOTING.md) for the safeguarded PowerShell sequence. **No agreed amount has yet been written to the AWS record by this code commit.**

## Host administration — private terminal only

Use the host's own AWS credentials with least-privilege permission on the booking table. In PowerShell set `$env:BOOKINGS_TABLE` to the deployed table name, and configure `AWS_PROFILE`/region for the relevant account. From `services/booking-api/` install packages and run:

```powershell
npm install
node admin.mjs list
node admin.mjs show <booking-reference>
node admin.mjs record-direct-price <already-reserved-direct-block-id> geranium=1450 honeysuckle=1650
node admin.mjs block geranium 2027-08-28 2027-09-04 "Confirmed Airbnb booking"
node admin.mjs approve <booking-reference> 1450.00 https://pay.sumup.com/EXAMPLE
node admin.mjs approve <booking-reference> 1400.00 https://pay.sumup.com/EXAMPLE "Returning guest discount"
node admin.mjs confirm <booking-reference> <verified-sumup-payment-reference>
node admin.mjs decline <booking-reference>
node admin.mjs unblock <manual-block-reference>
node admin.mjs cancel <confirmed-booking-reference> "Refund discussed and recorded"
```

**On approval**, separately review the guest, total amount, correct Strict cancellation wording and SumUp link; the CLI **does not send the payment email**. This implementation uses manually created **SumUp Payment Links** (`pay.sumup.com`), not SumUp API Hosted Checkout sessions (`checkout.sumup.com`). SumUp's API Hosted Checkout sessions expire after 30 minutes, so they must not be substituted for a manually emailed link with a 48-hour guest payment window. Set the manual Payment Link expiry appropriately in the SumUp dashboard. On confirmation, visually verify payment in the SumUp dashboard before issuing the final guest confirmation. The confirmation command cannot retrieve SumUp payments automatically yet, by design. Never mark paid on the basis of the guest browser redirect.

**Manually block** winter tenancies, maintenance closures, owner use and all confirmed Airbnb bookings before inviting direct requests. Every manual block is written in **one atomic DynamoDB transaction**; the tool refuses blocks of more than 99 **cottage-nights**. Divide winter tenancies into consecutive monthly blocks. The host must verify any confirmed Airbnb booking and winter let against the master calendar before opening direct requests. There is no public administration endpoint.

## Reservation origin and read-only Airbnb reconciliation

Every guest booking request now receives `source=direct` and a separate `reservationStatus` (e.g. PENDING_REVIEW / AWAITING_PAYMENT / CONFIRMED). The DynamoDB `status` controls the actual reservation hold and remains authoritative.

Existing `BLOCKED` records must be **classified in place** using `node admin.mjs classify ID SOURCE RESERVATION_STATUS [EXTERNAL_REF]`. This updates only the booking metadata item (never a cottage date slot). Supported sources include `airbnb`, `direct`, `owner`, `winter-let`, and `maintenance`. Classify confirmed Airbnb bookings as `airbnb CONFIRMED` and the held 28 August 2027 off-Airbnb booking as `direct RESERVED` until final payment/confirmation. **Do not re-create existing blocks.** If the external Airbnb reference is not known, omit it; do not invent a reference number. Reclassifying a record already assigned to another source is refused.

Use local Airbnb exports and your isolated staging-table AWS credentials to run the **read-only** comparison. From the repository root:

```powershell
$env:AWS_PROFILE = "default"
$env:AWS_REGION = "eu-west-2"
$env:BOOKING_ENVIRONMENT = "staging"
$env:BOOKINGS_TABLE = "<actual deployed STAGING DynamoDB table>"
node services/booking-api/reconcile-airbnb.mjs geranium "$HOME\Downloads\LesButtesCalendars\geranium.ics" 2027-03-20 2027-10-02
node services/booking-api/reconcile-airbnb.mjs honeysuckle "$HOME\Downloads\LesButtesCalendars\honeysuckle.ics" 2027-03-20 2027-10-02
```

The end date is **exclusive**. The report separates matching Airbnb-source dates, Airbnb-only blocks missing from our master, master Airbnb blocks missing from Airbnb, still-unclassified master records, and other-source (especially direct-booking) blocks in Airbnb's export. **No AWS writes are made** by this report. A date disappearing from the Airbnb iCalendar must **never** automatically cancel the master reservation; always compare with actual Airbnb reservation status, and never overwrite a direct booking. Airbnb calendar updates and imports are delayed.

**Important:** The five 2027 Airbnb bookings and one both-cottage direct reservation have already been entered into the test table as six `BLOCKED` records. Classification commands for their exact IDs are provided in the accompanying project conversation, not hardcoded in this repository. The two cancelled synthetic test records need no classification.

## Availability calendar and guest privacy

- All availability checks revalidate server-side. The client 27-night limit is for UX only.
- `expiresAt` is the DynamoDB TTL attribute. Unapproved date holds become available when their expiry passes regardless of DynamoDB's asynchronous deletion. Unconfirmed guest request metadata expires after 90 days; confirmed reservations are retained pending a documented retention policy.
- iCal events contain only "Unavailable", not guest names, email or financial details.
- Guest contact data is stored in DynamoDB and emailed only to the host; consent, privacy notices, retention, and access controls need review before production.
- The booking API must be deployed in an AWS region suitable for Les Buttes' GDPR/data-protection obligations. Enable monitoring, backups, alarms and a sensible AWS budget. DynamoDB on-demand capacity, PITR, API requests and emails can generate small charges, even with very low traffic.

## Activation checklist — all required

- [ ] Confirm 2027 open/close dates and exact 3/5/7-night minimum-stay periods.
- [ ] Load all confirmed Airbnb bookings and winter lets into the master calendar, and reconcile with Airbnb calendars.
- [ ] Verify **both Airbnb listings are request-to-book**, set **27-night maximum** in Airbnb manually and connect each correct calendar feed.
- [ ] Approve and configure all 2027 nightly prices in `BOOKING_RATES_JSON` (with explicit live-rate status), test boundaries, and verify quotes against Airbnb; finalise exact short-stay Strict cancellation wording and refund responsibilities.
- [ ] Set up AWS SAM, test DynamoDB transactions/conflicts, test rejected 28-night dates and both-cottage atomicity, verify SES sender/recipient and notifications. Run `npm run test:booking` from the repository root.
- [ ] Configure Turnstile keys and test captcha and anti-abuse rate limits, including input errors, webhook failures and accessibility.
- [ ] Confirm hosted SumUp link creation and manual payment verification workflow using the Guernsey merchant account.
- [ ] Build a proper authenticated admin view and reconciliation/exception report if terminal-only operations are inadequate.
- [ ] Set `BOOKING_REQUESTS_ENABLED=true` only when above is complete, and set `PUBLIC_BOOKING_API_URL` plus `PUBLIC_TURNSTILE_SITE_KEY` **at website build time**.
- [ ] Run end-to-end testing for approve/decline/payment expiry/cancellation, and only then link the new page from normal "Book" CTAs.
- [ ] Update Airbnb-only payment assertions on the website (Contact and cottage descriptions) in all languages, after the direct route is operational.

The current feature is a safe **scaffold**, not a claim that online payments or Airbnb updates are automated end-to-end. Changes to the website's existing `main` deployment must not include real booking CTA links until the API is deployed and tested separately. A static preview on the feature branch cannot receive bookings.
