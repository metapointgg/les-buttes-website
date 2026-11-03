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
