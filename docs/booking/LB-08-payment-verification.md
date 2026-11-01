# LB-08 — Independent SumUp payment verification

**Status:** Pure verification policy and mocked regression tests committed. Not connected to any booking status transition, HTTP endpoint, webhook or production environment.

`sumup-payment-verification.mjs` accepts a **registered local checkout**, an authoritative booking record, and a **fresh checkout response independently retrieved from SumUp**. It requires matching checkout ID, checkout reference, merchant code, GBP currency, exact pence amount, direct booking identity, approved amount, and `AWAITING_PAYMENT` reservation state. It requires checkout status `PAID` and exactly one successful transaction with an ID. It returns a verification evidence object or an explicit failure; it does not write to DynamoDB.

**Provider contract must be verified in sandbox:** the exact transaction status enumeration, shape and availability of `transactions` in SumUp checkout retrieval may differ. The strict policy will reject unfamiliar shapes until validated; do not relax it based on webhook assertions. Verify with the official provider API and test credentials before enabling.

**Next:** Use strongly consistent local reads, retrieve the checkout independently by ID, and atomically transition the booking plus all held cottage-night slots with an immutable audit record, conditional on current state and checkout identity. Deduplicate transaction IDs and webhook events. Browser redirects and webhook payloads must only trigger a verification attempt, never directly confirm a booking. The existing code does not enable a payment route.
