# LB-09 — SES sender readiness by AWS region

**Verified 3 November 2026. Account 145608514666. No emails sent.**

**Update:** subsequent live SESv2 `GetAccount` confirmed **ProductionAccessEnabled=true**, `SendingEnabled=true`, Max24HourSend=50,000 and MaxSendRate=14 in `us-east-1`. `lesbuttes.com` identity, DKIM and custom MAIL FROM are all `SUCCESS`. The earlier sandbox restriction in this document is now historical; the application staging allowlist and explicit opt-in still protect against accidental guest sends.

## US East (N. Virginia), `us-east-1` — configured identity; sandbox restriction

SESv2 `GetEmailIdentity` confirms `lesbuttes.com` **VerifiedForSendingStatus=true**, `VerificationStatus=SUCCESS`, DKIM **SUCCESS** (signing enabled), and custom MAIL FROM domain `mail.lesbuttes.com` **SUCCESS**. This matches the user's AWS Health notification. `GetAccount` confirms `SendingEnabled=true`, **ProductionAccessEnabled=false**, `Max24HourSend=200`, `MaxSendRate=1` and `SentLast24Hours=0`.

**Conclusion:** domain, DKIM and MAIL FROM are configured in `us-east-1`; this region's SES account is in the sandbox. Sending is permitted only to verified recipients (or the SES mailbox simulator) until AWS grants production access. Do not send live guest booking messages automatically.

## London, `eu-west-2` — a separate regional identity

Prior read-only SESv1 inspection reported `lesbuttes.com` identity verification **Failed** and DKIM verification **Failed** in `eu-west-2`. That does not contradict the successful setup in `us-east-1`: SES identity verification is region-specific. Do not say the domain is universally unverified.

## Implementation decision and acceptance work

1. Prefer the **already verified `us-east-1` SES identity** for staging, explicitly configured as a separately regional SES client, or independently verify `eu-west-2` if keeping all services regional is required. Do not silently use the Lambda runtime's `eu-west-2` default SES region.
2. Use verified test recipient addresses or the SES mailbox simulator while production sending remains disabled. Request SES production access in `us-east-1` before unrestricted guest mail, subject to AWS approval.
3. Build controlled staging SES templates, immutable delivery/outbox records, idempotent retries, bounce/complaint handling, and allowlisted test recipients. Test approval/payment instruction, decline, confirmation, cancellation, expiry and failure states.
4. Demonstrate sender authentication, message delivery and no duplicates through an authorised staging test before marking LB-09 complete. Production messages remain disabled until owner approval.

**LB-09 status: open.** **The earlier diagnosis 'lesbuttes.com DNS/DKIM must be repaired' was incorrect as a global statement and has been replaced.** Outstanding: production access in chosen SES region and full application delivery acceptance. No customer email has been sent.

## Incremental implementation — staging sender guard (3 November 2026)

`services/booking-api/booking-staging-ses-policy.mjs` contains a pure, side-effect-free staging-only policy and message validator, with `booking-staging-ses-policy.test.mjs` in CI. No email transport or automatic lifecycle hook is enabled by this change.

Required **explicit** configuration (all disabled/invalid by default):

| Environment variable | Requirement |
| --- | --- |
| `BOOKING_ENVIRONMENT` | `staging` |
| `BOOKING_SES_REGION` | `us-east-1`, independent of booking Lambda's `AWS_REGION=eu-west-2` |
| `BOOKING_EMAILS_ENABLED` | Exactly `true` (no default opt-in) |
| `BOOKING_SES_SANDBOX_ACK` | Exactly `true`; acknowledges sandbox verified-recipient restriction |
| `BOOKING_SES_FROM` | Explicit sender address at `lesbuttes.com` |
| `BOOKING_SES_TEST_RECIPIENTS` | Comma-separated list of one to twenty distinct, valid, SES-verified staging test recipient addresses |

`validateStagingSesMessage` also rejects non-allowlisted guest recipients, unexpected lifecycle event types, malformed booking references/template identifiers, empty/overlong bodies and subject-line CR/LF injection. The allowlist is a **local guard**, not proof that a recipient is verified in SES: the eventual SES client must also respect SES sandbox restrictions and obtain the required runtime authorisation.

**Still outstanding for LB-09 acceptance:** SES SDK transport with explicitly selected client region, immutable outbox/idempotency and retry states, recipient verification or simulator-only tests, lifecycle templates, bounce/complaint handling, authorised staging send and delivery verification, then production access and owner sign-off. This step does not send email, change live SES settings or close LB-09.

## Incremental implementation — explicit regional SES transport

`services/booking-api/booking-staging-ses-transport.mjs` uses the installed AWS SDK `@aws-sdk/client-ses` and explicitly creates a `SESClient({region:'us-east-1'})` only after `validateStagingSesMessage` passes. Testable injected factories make all regression tests network-free. It sends text-only UTF-8 messages with one allowlisted recipient, returns the SES `MessageId` as `ACCEPTED_BY_SES_NOT_DELIVERED` (not delivered), and fails closed for missing provider acknowledgement or errors. It is not attached to a booking event or deployed Lambda, and has no live send path unless future staging wiring explicitly invokes it.

**Important configuration clarification:** the existing `BOOKING_SES_SANDBOX_ACK` flag remains a conservative staging-test safeguard name for this release, but **AWS production access is now granted**; it is not evidence the AWS account remains sandboxed. It may be renamed in a separately tested change. The test-recipient allowlist is mandatory even after SES production access.

Still required before acceptance: durable outbox/idempotency, bounce/complaint signal processing, lifecycle email templates, real staging delivery test with consented recipient, and separate production enablement/owner approval.

## Durable once-only email outbox (3 November 2026)

`booking-email-outbox.mjs` adds a conditional DynamoDB claim in the **authoritative staging booking table** at `PK=BOOKING#<bookingId>`, `SK=EMAIL#<lifecycleType>#<templateId>`. The claim is inserted with `attribute_not_exists(PK) AND attribute_not_exists(SK)` **before** any SES transport invocation. All inputs must first pass the explicit staging SES region/recipient and feature-flag guard. Only a single successful claimant may invoke SES; later/replayed events read the existing claim consistently and return `ALREADY_CLAIMED` without sending again.

On an SES acknowledgement, the item is conditionally advanced from `CLAIMED` to `ACCEPTED_BY_SES_NOT_DELIVERED` with the opaque SES message ID. **SES acceptance is not delivery proof.** If the SES request times out or the provider receipt/DynamoDB acknowledgement is uncertain, the claim remains permanent with `RECONCILIATION_REQUIRED` where possible, otherwise `CLAIMED`, and an error requires **manual reconciliation**. **Do not automatically release/retry ambiguous claims**, which could duplicate a payment email. Network-free regression tests cover success, duplicate events, ambiguous send outcomes, failed status writes, safety gating and stable event keys.

This is a **library implementation only**. The staging booking API has NOT had an automatic email hook added, and **no live DynamoDB writes or SES sends occurred**. Outstanding: choose documented lifecycle template revisions and version-change policy; outbox queue/worker with explicit manual recovery; deterministic SES delivery/bounce/complaint event mapping; scheduled delivery-retry policy solely for conclusively unsent messages; staging end-to-end and owner approval. LB-09 remains open.

## Lifecycle email templates (3 November 2026)

`services/booking-api/booking-lifecycle-email-templates.mjs` is a pure, deterministic renderer for six versioned lifecycle messages: `approval_payment_v1`, `declined_v1`, `confirmed_v1`, `cancelled_v1`, `hold_expired_v1` and `delivery_failure_v1`. Matching network-free tests cover rendering, malicious inputs and strict state restrictions.

The approval/payment email requires `APPROVED_AWAITING_PAYMENT`, an authoritative matching GBP checkout, exact approved amount in pence, `PENDING` checkout state and an HTTPS URL on exactly `checkout.sumup.com`. The confirmed email requires `CONFIRMED` plus explicit `paymentVerified=true`; it must not be driven merely by a customer redirect or unverified webhook. Cancellation does not imply a refund. Cottage names, booking UUID and ISO dates are validated. Subject and operational metadata cannot inject untrusted headers.

**Important integration dependency:** the source-of-truth adapter must populate `paymentVerified` only following independent SumUp transaction reconciliation, never from a caller-controlled request field. No event hook currently invokes the renderer. The wording and operational sender/recipient policy require owner review before external messaging. This completes a **template implementation subtask**, not LB-09 acceptance. SES transport deployment, delivery/bounce event correlation, durable outbox lifecycle retries and staging delivery evidence remain outstanding.

## Conditional SES outcome correlation (3 November 2026)

`booking-ses-outcome.mjs` adds a pure classifier and conditional DynamoDB update for previously recorded SES message outcomes: `Delivery → DELIVERED`, `Bounce → BOUNCED`, and `Complaint → COMPLAINED`. It requires the matching SES message ID and a single matching recipient in the SES mail metadata and outbox record. It rejects unknown event types, malformed bounce/complaint details and inconsistent identities. A duplicate outcome is not written. A late bounce/complaint can supersede an earlier delivery; a stale conditional state requires manual reconciliation rather than an unconditional overwrite.

**Not yet an event consumer:** `applyVerifiedSesOutcome` takes an `authenticatedSns` internal safeguard, but that boolean is **not** cryptographic SNS authentication. The future trusted SNS adapter must validate AWS SNS signature and certificate, allowed topic ARN/account/region, event freshness and payload size before using this function; it must never expose that parameter to public HTTP callers. A trusted message-ID lookup is also needed. Do not interpret email delivery as payment confirmation. No real SNS subscriptions, outbox writes or emails were created.

Tests cover delivery, bounce, complaint, late adverse outcome after delivery, duplicate notification, mismatched IDs/recipients, absent authentication, unsupported event, stale conditional updates and production table rejection. **Remaining LB-09 acceptance:** signed SNS intake, SES-message-ID lookup, real staging notifications, recovery workflows and owner-approved templates.

## SES delivery/bounce/complaint correlation (3 November 2026)

`booking-staging-ses-transport.mjs` now attaches `bookingId`, `emailType` and `templateId` as provider message tags. These tags correlate SES events with an immutable outbox identity, but **are not authentication**.

`booking-ses-feedback.mjs` is a deliberately unexposed library function: the caller must first supply an SNS `Notification` envelope and a **real, independently implemented SNS signature-verification callback**. It fails before DynamoDB reads if the callback is missing or rejects the envelope. It then checks the SES provider message ID, recipient, booking ID, event type and template ID against the existing outbox record using a consistent DynamoDB read. Only a conditional `UpdateItem` modifies outbox delivery state. Delivery, bounce and complaint signals are idempotent; bounce/complaint can supersede delivery, but later delivery cannot clear a terminal failure. No booking or payment status is changed, and the reconciler cannot send emails.

Network-free tests cover successful delivery, bounced/complained, replay, invalid signature, wrong SES message ID or recipient, and no provider acknowledgement. **Remaining security work before any endpoint deployment:** implement and test AWS SNS signature verification including certificate origin, signature and freshness; configure SES event publishing, subscriptions, DLQ/alarms and IAM; verify deliveries with a controlled recipient and customer wording. Do not expose this reconciler via an unauthenticated HTTP endpoint or treat SES tags as proof of identity.

**Status:** LB-09 still unchecked; code only, no AWS subscriptions, email sends or production changes in this step.
