# Les Buttes — Direct booking terms and payment design (DRAFT)
Updated 24 October 2026. Status: OWNER AND GUERNSEY LEGAL REVIEW REQUIRED. Do not publish, merge booking activation, email to guests, or collect payment on the basis of this draft.

## Model and contract formation
1. Guest chooses eligible cottage(s), 2027 Saturday-to-Saturday dates, party size and reviews an indicative price.
2. Guest sees a clear **Request booking — not confirmed** action, the entire price in GBP, accommodation particulars, prospective payment schedule and cancellation terms, plus a separate affirmative, unticked box accepting the identified version of guest terms and acknowledging the privacy notice.
3. On submission, backend rechecks both-unit booking-master availability and independently reconciles inbound Airbnb occupancy, guest count, dates, rate and any manual override. Record request with opaque ID and versioned draft-terms acceptance evidence; never trust browser price.
4. Owner reviews and explicitly approves a quote with a fixed total, expiry and payment schedule. A non-payable provisional hold may be placed atomically in the master, with TTL, but **never** treated as confirmation.
5. Send a time-limited server-created SumUp hosted payment link (not a client-specified amount). Once a webhook arrives, retrieve the checkout/transaction directly from SumUp and verify merchant, currency GBP, amount, reference, payment status and idempotency. Only then mark payment received and send a confirmation, preserving the master reservation.
6. If payment fails, expires, is reversed, or a price/date mismatch is found, do not confirm; release or review the hold according to the agreed policy. Support refund and chargeback reconciliation.
7. No outgoing Airbnb calendar update should be assumed until its integration is proven; reconcile calendars before acceptance.

## Draft commercial choices — not approved
- **Deposit:** recommend 25% of total on owner acceptance, with remainder due 56 days before arrival. For a booking inside 56 days, full payment on acceptance.
- **Refund policy for guest cancellations:** recommend full refund of payments received if cancelled at least 56 full days before local check-in; within 56 days consider a graduated and clearly disclosed schedule rather than blanket forfeiture. **Specific percentages, handling of deposit, statutory exceptions, insurance advice, refunds if the dates relet and exceptional circumstances require owner and legal approval.**
- **Owner cancellations:** full refund and prompt notification as a baseline, with legal review of further obligations.
- **Refund administration:** use original payment route where possible, keep transaction evidence and avoid promising exact processing time.
- **Prices:** customer quote records the agreed full price, any separate taxes/fees (if relevant), and payment dates. October 2026 preview prices are indicative only. No automatic '11% saving' promise until final rate methodology approved.
- **Check-in/out:** times to be confirmed. Saturday arrival and Saturday departure already configured for this pilot; any low-season exceptions require explicit rule decisions.
- **Occupancy:** Geranium max 4 guests/2 bedrooms; Honeysuckle max 6 guests/3 bedrooms; both together max 10/5 bedrooms. Fire and occupancy rules to be verified.
- **Property terms:** maximum occupancy, child supervision, smoking, pets, quiet hours, parking, accessibility, housekeeping, damage reporting, late arrival and force majeure need agreed wording and factual verification.

## Draft guest-facing acceptance copy (NOT FOR PUBLICATION)
> Your reservation is not confirmed when you submit this request. We will check availability and the final price and, if we can accept the booking, send you the agreed terms and a secure payment link. Your booking is confirmed only when we have verified the required payment and issued written confirmation.
>
> I have read and agree to the Les Buttes Holiday Cottages Guest Booking Terms (version [VERSION]) and understand the cancellation and payment terms. [unticked checkbox, required]
>
> I acknowledge the Privacy Notice (version [VERSION]). [link, not bundled with optional marketing consent]

Do not request payment card information in our guest form. Payment must occur on SumUp's hosted checkout or other approved PCI-compliant flow.

## Data handling
- Identify the **actual accommodation supplier / contracting entity**, Guernsey service address, public contact email and dispute/contact procedure; do not assume the consultancy is the supplier.
- Privacy notice needs controller identity, lawful basis, booking data categories, processors (hosting, SumUp, mail), possible transfers, retention, rights and contact details. Marketing opt-in must be independent.
- Store terms version, content hash, acceptance timestamp, identity of request and quote/payment version. Restrict guest-data logs, retention and access; never log credentials or full payment card data.
- Confirmation email needs precise cottage(s), full party size, dates, total and paid/outstanding sums, cancellation deadline as a date/time in Guernsey local time, check-in/out and emergency contact details.
- EN/NL/FR terms should be equivalent and reviewed; specify authoritative contractual language.

## API and state machine to design
REQUESTED -> REVIEW_PENDING -> APPROVED_AWAITING_PAYMENT -> CONFIRMED -> COMPLETED
Alternative outcomes: DECLINED, EXPIRED, CANCELLED_BY_GUEST, CANCELLED_BY_OWNER, REFUND_PENDING, REFUNDED, PAYMENT_DISPUTED.
All transitions idempotent, authorised server-side, auditable, with atomic availability reservation and documented hold expiry.
Explicitly reject client-supplied amounts/approval flags; use webhook as a signal only, verify by retrieving provider transaction.
Invoice and payment links must reference same immutable owner-approved quote/version.

## Go-live acceptance tests
- Two guests attempt overlapping dates; only one can reserve; occupied data remains correct for each cottage and both cottages together.
- Paid checkout amount, GBP currency, merchant, reference and quote match; webhook replay and delayed webhook do not duplicate confirmations.
- Guest clicks 'paid' redirect but payment fails -> remains unconfirmed.
- Hold expiration, cancellation/refund (full/partial), chargeback and payment failures leave booking master correct.
- Incoming Airbnb blocks, outgoing calendar updates, monitoring/notifications, stale/offline availability and manual edits reconciled.
- 2027 final prices, stay rules, terms, cancellation cutoff and privacy approved in writing; all guest-facing languages checked.
- Test against SumUp sandbox; merchant eligibility, Guernsey availability, actual payment link fees, and payouts independently verified.
- Release by separate explicit owner sign-off. Never enable PUBLIC_BOOKING_REQUESTS_ENABLED or merge solely as part of this drafting step.

## Primary references to review
- https://developer.sumup.com/online-payments/webhooks
- https://developer.sumup.com/api/transactions/refund
- https://help.sumup.com/en-GB/articles/1bTBfAoe7SiaKiUxCo2uzP-payment-links-faq
- https://www.odpa.gg/data-processing-notice

**Legal note:** This document is a working product design and draft commercial policy, not a legal opinion. Guernsey-specific contract and consumer protection rules must be checked by a qualified adviser; do not assume UK or Jersey cancellation legislation automatically applies.
