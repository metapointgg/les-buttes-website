# LB-08 — Independent SumUp payment verification

**Status:** Pure verification policy and mocked regression tests committed. Not connected to any booking status transition, HTTP endpoint, webhook or production environment.

`sumup-payment-verification.mjs` accepts a **registered local checkout**, an authoritative booking record, and a **fresh checkout response independently retrieved from SumUp**. It requires matching checkout ID, checkout reference, merchant code, GBP currency, exact pence amount, direct booking identity, approved amount, and `AWAITING_PAYMENT` reservation state. It requires checkout status `PAID` and exactly one successful transaction with an ID. It returns a verification evidence object or an explicit failure; it does not write to DynamoDB.

**Provider contract must be verified in sandbox:** the exact transaction status enumeration, shape and availability of `transactions` in SumUp checkout retrieval may differ. The strict policy will reject unfamiliar shapes until validated; do not relax it based on webhook assertions. Verify with the official provider API and test credentials before enabling.

**Next:** Use strongly consistent local reads, retrieve the checkout independently by ID, and atomically transition the booking plus all held cottage-night slots with an immutable audit record, conditional on current state and checkout identity. Deduplicate transaction IDs and webhook events. Browser redirects and webhook payloads must only trigger a verification attempt, never directly confirm a booking. The existing code does not enable a payment route.

## Conditional confirmation transaction builder

`sumup-payment-confirmation.mjs` prepares (but does not execute) one DynamoDB transaction. It conditionally moves the authoritative direct booking from APPROVED_AWAITING_PAYMENT/AWAITING_PAYMENT to CONFIRMED, verifies immutable checkout registration, removes expiry from all owned cottage-night slots, inserts a globally unique provider transaction claim, and records an immutable audit event. All changes succeed or fail together. Booking hold expiry and observed stay allocation are checked. This module does not accept a browser or webhook payment assertion: the caller must first run independent provider verification.

**Outstanding:** Verify actual provider response schema and booking slot persistence in staging; add strongly consistent reads and execution wiring, transactional idempotent retry handling, provider transaction identity namespace, and payment event/webhook security. No route or live payment processing is enabled.
