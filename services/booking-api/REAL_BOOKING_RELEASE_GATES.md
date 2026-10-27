# Real booking requests: release gates (27 October 2026)

The synthetic localhost submission endpoint must stay synthetic only. No production deployment in this phase.

## Implemented preparatory work
- `real-request-contract.mjs` is a **pure function** that validates future real guest contact details and separate booking-terms / cancellation acceptance using a published version and SHA-256 digest. It intentionally has no imports from AWS, no persistence, no network access, and is not called by any public or staging submission route.
- The tests enforce absent/stale policy rejection, independent optional marketing consent, occupancy capacity and guest input validation.
- These are preparatory validation rules, **not a live privacy, policy, or booking service**.

## New isolated foundation (not deployed)
- `real-booking-storage.mjs` prepares a metadata-only booking row, KMS-encrypted guest contact row and an idempotency marker, all as **unexecuted** transactional items. The encryption callback must be supplied by the eventual private Lambda service. No AWS route, IAM grant or persistence is introduced by this module. The forthcoming service must atomically couple these records to conflict-safe date holds and server-side verified quotes.
- `test/real-booking-storage.test.mjs` checks PII separation, encryption failure and idempotency-key behavior.
- Owner-facing policy text and cancellation wording will be managed through the CMS later. A published, immutable policy version and digest must still be available before accepting real guests.

- `real-booking-transaction.mjs` assembles a **dry-run only** 17-item conditional transaction for both cottages / seven nights: server-calculated quote, encrypted private contact record, booking metadata, idempotency marker and 14 atomic slot claims. No execution helper or endpoint exists. A collision must fail the entire future DynamoDB transaction, with no partial guest record. \n- `test/real-booking-transaction.test.mjs` checks conflicts, price validation, absence of plaintext in planned DynamoDB items, and staging-only guards.\n\n## Required implementation before any real guest information is accepted
1. Approve actual guest booking terms and cancellation policy, business details, check-in/out times and data protection notice. Publish immutable terms/cancellation versions and digests through booking master. Do not invent policy wording or claim policies are approved.
2. Create an isolated real-request API behind an explicit disabled-by-default feature flag; do not adapt the synthetic handler to store real guest details by changing its flag.
3. Store PII separately with KMS-managed encryption, minimum IAM roles, retention policy, audit events, documented deletion/correction processes; exclude contact information from indexes, public API and CloudWatch logs. Define what staff roles can view.
4. Apply server-side quote/rules/availability validation and atomic conflict-safe booking hold, with rate limiting, CAPTCHA, retry idempotency and consistent expiry. Determine safe handling for requests created when rate limiting is exhausted.
5. Record terms version/digest and accepted timestamp on server; enforce explicit guest consent before submission. Marketing opt-in must be optional and separate.
6. Give guests a request acknowledgement distinct from a booking confirmation; wire SES to a verified sender and management notification, ensure deduplication and safe retry.
7. Preserve approval step. Only after owner approval create a SumUp payment link; verify signed webhook/API payment state independently before CONFIRMED, without exposing payment secrets in the browser.
8. Define cancellations, refunds, payment deadlines, expired holds, monitoring, recovery and an approval-led switch from staging to production.

## Invariants
- Synthetic guest submission stays synthetic with test@example.invalid, no real contact persistence, no SumUp integration or guest notifications.
- Real booking flow remains unavailable until all gates are implemented and individually reviewed.
- The four-step booking preview can continue to be tested without PII persistence.
