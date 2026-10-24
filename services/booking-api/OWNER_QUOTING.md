# Owner-only direct price preview — 2027

**Read-only, local CLI. NOT the guest pricing API and NOT a booking request, a payment link or evidence of availability.**

The source of comparison is the **October 24 2026 screenshot transcription** of both Airbnb host calendar monthly rates (already adjusted for Airbnb's new fee structure). It only covers arrival nights **20 March through 1 October 2027** and checkout no later than **2 October**. It intentionally ignores the earlier proposed additional Easter/summer nightly price overlays.

The agreed commercial approach is **share the Airbnb platform-fee saving** between guest and Les Buttes, using the actual agreed **28 Aug–4 Sep 2027** returning-guest booking as precedent: £1,630 Airbnb vs £1,450 direct for Geranium; £1,845 vs £1,650 for Honeysuckle. The owner remains responsible for manually approving every future quote.

## Local usage

From the repository root:

```powershell
npm run test:booking

# Compare both cottages on the actual held August/September week:
node services/booking-api/preview-direct-quote.mjs both 2027-08-28 2027-09-04

# Example of a five-night stay spanning May and June:
node services/booking-api/preview-direct-quote.mjs both 2027-05-29 2027-06-03

# Show how an explicitly negotiated offer compares with the indicative guide:
node services/booking-api/preview-direct-quote.mjs both 2027-08-28 2027-09-04 --geranium 1450 --honeysuckle 1650

# One cottage:
node services/booking-api/preview-direct-quote.mjs geranium 2027-04-12 2027-04-17
```

The command displays, per cottage and combined:
- Comparable Airbnb accommodation rate total across all **occupied nights**, with checkout excluded and month transitions priced precisely
- Suggested (NOT automatically approved) direct total using approximately 11% savings from that snapshot, **rounded per cottage to £25 for short stays or £50 for 7+ nights**
- Any manually entered alternative offer, saving in pounds and percent, and illustrative net receipts with assumed 15.5% Airbnb vs 2.5% SumUp fees
- Whether the visit satisfies **draft, unapproved** 3/5/7-night minimum-stay periods

**The output is not a guest quotation and should never be copied to a guest without reviewing the current Airbnb calendar, source-based master booking availability, updated fees, inclusion of any additional guest charges and the direct terms.** Existing reservations are not repriced or touched. The code requires no AWS credentials, reads no guest information, performs no network requests and cannot place/remove any hold.

For the agreed 28 Aug–4 Sep week, the guide should show **Geranium £1,450**, **Honeysuckle £1,650**, **both £3,100** against Airbnb £3,475. These agreed historic prices take precedence over any recalculated guide.

## Before accepting an actual direct booking

1. Verify comparable Airbnb rates for *exact requested nights* and availability in Airbnb's hosting calendar as well as the current AWS master. Remember that Airbnb exports can lag.
2. Confirm the guest count and cottage capacities (Geranium 4, Honeysuckle 6, combined 10). Provisional short-stay rules remain unapproved.
3. Confirm the guest-facing **all-in** price, including any cleaning or other compulsory charges, and check the actual merchant fees and cancellation risk.
4. Approve the rounded agreed offer manually; if the quote changes from the original guest-facing proposal, note the reason in the private booking approval command.
5. Give the guest the proposed terms and cancellation/refund conditions *before* requesting payment. Confirm only after independent verification of payment.
6. Record the guest's final agreed amount separately from the source-calendar estimate. An unpriced `BLOCKED` direct reservation is **not** evidence that a specific amount has been recorded in AWS.
7. Retain the Airbnb calendar's **manual block for that direct reservation** until the direct booking has completed or been explicitly cancelled.

**No automatic coupon, no fixed or guaranteed percentage discount, no season/rate activation and no production website changes.** Both screenshots are time-stamped observations, not authoritative future Airbnb pricing.
