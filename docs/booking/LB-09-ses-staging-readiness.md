# LB-09 — SES sender readiness by AWS region

**Verified 3 November 2026. Account 145608514666. No emails sent.**

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
