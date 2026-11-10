# LB-08 — Independent SumUp payment verification

**Status (2026-11-02):** Staging-gated reconciliation executor, atomic confirmation transaction, signed internal trigger and replay claim are implemented with mocked integration tests. They are not deployed to AWS and no public payment route or external SumUp webhook receiver is enabled.

`sumup-payment-verification.mjs` accepts a **registered local checkout**, an authoritative booking record, and a **fresh checkout response independently retrieved from SumUp**. It requires matching checkout ID, checkout reference, merchant code, GBP currency, exact pence amount, direct booking identity, approved amount, and `AWAITING_PAYMENT` reservation state. It requires checkout status `PAID` and exactly one successful transaction with an ID. It returns a verification evidence object or an explicit failure; it does not write to DynamoDB.

**Provider contract must be verified in sandbox:** the exact transaction status enumeration, shape and availability of `transactions` in SumUp checkout retrieval may differ. The strict policy will reject unfamiliar shapes until validated; do not relax it based on webhook assertions. Verify with the official provider API and test credentials before enabling.

**Next:** Use strongly consistent local reads, retrieve the checkout independently by ID, and atomically transition the booking plus all held cottage-night slots with an immutable audit record, conditional on current state and checkout identity. Deduplicate transaction IDs and webhook events. Browser redirects and webhook payloads must only trigger a verification attempt, never directly confirm a booking. The existing code does not enable a payment route.

## Conditional confirmation transaction builder

`sumup-payment-confirmation.mjs` prepares (but does not execute) one DynamoDB transaction. It conditionally moves the authoritative direct booking from APPROVED_AWAITING_PAYMENT/AWAITING_PAYMENT to CONFIRMED, verifies immutable checkout registration, removes expiry from all owned cottage-night slots, inserts a globally unique provider transaction claim, and records an immutable audit event. All changes succeed or fail together. Booking hold expiry and observed stay allocation are checked. This module does not accept a browser or webhook payment assertion: the caller must first run independent provider verification.

**Outstanding:** Verify actual provider response schema and booking slot persistence in staging; add strongly consistent reads and execution wiring, transactional idempotent retry handling, provider transaction identity namespace, and payment event/webhook security. No route or live payment processing is enabled.

## Internal payment trigger and operational recovery

The HMAC-SHA256 internal trigger is **not** SumUp's provider webhook signature. Only trusted server-side infrastructure may possess the HMAC secret. No public handler should accept this secret or treat a provider callback as inherently authenticated.

An authenticated internal trigger is claimed in the staging DynamoDB table by SHA-256 of its signed body before reconciliation begins. The conditional claim prevents duplicate or concurrent delivery from running payment reconciliation twice. The claim has a 24-hour TTL; expiry is eventual, so claim deletion is not a retry mechanism. Because the claim is written before verification, even provider outages consume it.

**Recovery procedure (manual, no blind replay):**
1. Inspect the immutable trigger claim, checkout registration and booking metadata with strongly consistent reads. Avoid logging API credentials or sensitive payloads.
2. Independently retrieve the checkout from SumUp using server-side sandbox credentials. Check checkout ID, reference, merchant, GBP amount, successful transaction ID and expiry.
3. Check the immutable `PAYMENT_TRANSACTION#<transaction-id>` claim, booking confirmation and audit record. If all are consistent, do not create another confirmation.
4. If the provider reports paid but the booking is not confirmed, diagnose transaction conditions, expired hold, slot ownership and conflicts. Do not automatically extend a hold or override another reservation. Escalate for owner-approved recovery.
5. Use a *new authenticated internal reconciliation request* only when it is safe and within the valid booking hold. Never delete a replay claim to make an old event runnable again.

**Required before sign-off:** actual SumUp sandbox contract tests (including transaction status and return fields), real DynamoDB conditional/transactional tests and conflict behaviour, infrastructure IAM and network exposure review, owner-approved webhook/event authentication design, operational alerting, and a full staging booking journey. The mocked tests do not prove DynamoDB enforcement or external payment receipt.
