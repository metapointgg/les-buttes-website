# Les Buttes direct booking requests — implementation draft

**Not live, not production-ready. Do not switch on customer submissions until the acceptance checklist below is completed.**

This is a deliberately small request-to-book system for **Geranium, Honeysuckle or both**. The main Les Buttes Astro website remains static on S3/CloudFront and reuses a single booking page template in English, Dutch and French. Public routes: `/book/`, `/nl/book/`, `/fr/book/`. They show a disabled preview and direct visitors to existing Airbnb booking links until the environment is configured. The feature branch is separate from the production deployment workflow.

## Locked-in rules

- Guest check-in and checkout dates, 1 to **27 nights** (28+ nights must enquire separately).
- Capacities: Geranium 4, Honeysuckle 6, both cottages 10.
- Minimum stays are configured by dates, not hardcoded. Intended low/shoulder/peak minimums: 3/5/7 nights; **season cutover dates still require confirmation**.
- Seasonal open dates must be configured explicitly. Requests outside a configured open season are rejected.
- Every request **requires host approval**. No payment is requested at submission. The website displays a provisional quote based on explicitly configured nightly rates for both cottages.
- Hold the dates for 24 hours pending review; host approval extends the hold 48 hours while awaiting full payment.
- After reviewing the request, host creates a **SumUp payment link** for the agreed full price and sends it with booking terms. The guest has not booked until payment has been independently verified and the host marks it confirmed.
- Apply the agreed **Strict** cancellation policy to standard stays; detailed direct-booking wording, refund arithmetic and consumer terms must be finalised before taking payment.
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
  "periods": [
    {"start":"2027-03-20","end":"2027-06-30","geranium":100,"honeysuckle":120},
    {"start":"2027-07-01","end":"2027-10-01","geranium":140,"honeysuckle":160}
  ]
}
```

The host may vary the quoted amount only with an explicit recorded reason. Deposit, cleaning fees, taxes and discount codes are not implemented; the current quote assumes that configured nightly amounts are the full price of the accommodation. Check the figures and any statutory disclosures before launch.

Cloudflare Turnstile is required on public requests (free tier, externally hosted), and validated by the backend. Owner email notification is sent via SES when configured. The Lambda currently logs notification delivery failures; CloudWatch alarm/error review is required before launch.

## Host administration — private terminal only

Use the host's own AWS credentials with least-privilege permission on the booking table. In PowerShell set `$env:BOOKINGS_TABLE` to the deployed table name, and configure `AWS_PROFILE`/region for the relevant account. From `services/booking-api/` install packages and run:

```powershell
npm install
node admin.mjs list
node admin.mjs show <booking-reference>
node admin.mjs block geranium 2027-08-28 2027-09-04 "Confirmed Airbnb booking"
node admin.mjs approve <booking-reference> 1450.00 https://pay.sumup.com/EXAMPLE
node admin.mjs approve <booking-reference> 1400.00 https://pay.sumup.com/EXAMPLE "Returning guest discount"
node admin.mjs confirm <booking-reference> <verified-sumup-payment-reference>
node admin.mjs decline <booking-reference>
node admin.mjs unblock <manual-block-reference>
node admin.mjs cancel <confirmed-booking-reference> "Refund discussed and recorded"
```

**On approval**, separately review the guest, total amount, correct Strict cancellation wording and SumUp link; the CLI **does not send the payment email**. On confirmation, visually verify payment in the SumUp dashboard before issuing the final guest confirmation. The confirmation command cannot retrieve SumUp payments automatically yet, by design. Never mark paid on the basis of the guest browser redirect.

**Manually block** winter tenancies, maintenance closures, owner use and all confirmed Airbnb bookings before inviting direct requests. Every manual block is written in **one atomic DynamoDB transaction**; the tool refuses blocks of more than 99 **cottage-nights**. Divide winter tenancies into consecutive monthly blocks. The host must verify any confirmed Airbnb booking and winter let against the master calendar before opening direct requests. There is no public administration endpoint.

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
- [ ] Configure all 2027 nightly prices in `BOOKING_RATES_JSON`, test boundaries, and verify quotes against Airbnb; finalise exact short-stay Strict cancellation wording and refund responsibilities.
- [ ] Set up AWS SAM, test DynamoDB transactions/conflicts, test rejected 28-night dates and both-cottage atomicity, verify SES sender/recipient and notifications. Run `npm run test:booking` from the repository root.
- [ ] Configure Turnstile keys and test captcha and anti-abuse rate limits, including input errors, webhook failures and accessibility.
- [ ] Confirm hosted SumUp link creation and manual payment verification workflow using the Guernsey merchant account.
- [ ] Build a proper authenticated admin view and reconciliation/exception report if terminal-only operations are inadequate.
- [ ] Set `BOOKING_REQUESTS_ENABLED=true` only when above is complete, and set `PUBLIC_BOOKING_API_URL` plus `PUBLIC_TURNSTILE_SITE_KEY` **at website build time**.
- [ ] Run end-to-end testing for approve/decline/payment expiry/cancellation, and only then link the new page from normal "Book" CTAs.
- [ ] Update Airbnb-only payment assertions on the website (Contact and cottage descriptions) in all languages, after the direct route is operational.

The current feature is a safe **scaffold**, not a claim that online payments or Airbnb updates are automated end-to-end. Changes to the website's existing `main` deployment must not include real booking CTA links until the API is deployed and tested separately. A static preview on the feature branch cannot receive bookings.
