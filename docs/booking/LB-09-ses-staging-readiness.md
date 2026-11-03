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

## SNS signature verification library (3 November 2026)

`services/booking-api/booking-sns-signature.mjs` now implements the previously missing cryptographic boundary. It requires an **explicit** SNS topic ARN in `us-east-1` belonging to AWS account `145608514666`, only processes `Notification` messages (never subscription confirmations), verifies the expected topic and timestamp freshness, restricts the signing certificate URL to the AWS SNS `sns.us-east-1.amazonaws.com/SimpleNotificationService-<hex>.pem` HTTPS path (no redirects, alternate ports, query strings or foreign hostnames), retrieves a bounded signing certificate, validates its expiry and verifies the SNS RSA-SHA1/RSA-SHA256 signature over the AWS canonical field order.

Network-free and locally generated test-certificate regression tests cover valid RSA-SHA256, tampered message, wrong SNS topic/account/region, expired timestamp, subscription confirmation rejection, malformed signatures and malicious certificate URLs. The test's temporary self-signed certificate is for local cryptographic fixtures only and **does not imply trust in arbitrary production certificates**; production acceptance depends on the strict SNS certificate host/path checks and TLS.

To wire this library in future: instantiate `createSnsNotificationVerifier({expectedTopicArn:'arn:aws:sns:us-east-1:145608514666:<approved-topic>'})` in a trusted, staging-only SNS adapter and pass it as `verifyEnvelope` to `reconcileAuthenticatedSesFeedback`. **Do not invent or deploy a topic ARN before SNS event-publishing and permissions have been configured and reviewed.** An AWS subscription/SNS topic, queue, webhook endpoint and live SES event destination are not yet deployed. Further acceptance needs real SNS delivery simulation, bounce/complaint tracking and owner sign-off.

## Read-only AWS assessment and feedback infrastructure definition (3 November 2026)

AWS SESv2 in `us-east-1`: `GetEmailIdentity(lesbuttes.com)` confirms the existing identity uses configuration set `my-first-configuration-set`; `GetConfigurationSetEventDestinations` returns **none**. AWS SNS `ListTopics` returns no topics and SQS `ListQueues(QueueNamePrefix='les-buttes')` returns no queues in that region. Thus SES sending works, but the SES→SNS→outbox feedback mechanism is **not deployed**.

`infra/booking-api/lb09-ses-feedback-staging-us-east-1.template.yaml` defines a standalone, deploy-on-approval CloudFormation stack for this gap: SES configuration-set event destination for delivery/bounce/complaint, a staging SNS topic with SES service-only publish policy (scoped source account and source configuration set), an SSE-encrypted SQS queue subscribed with `RawMessageDelivery: false` so the full signed SNS envelope is retained, and an encrypted DLQ with five-receive redrive. No Lambda, DynamoDB table, existing booking stack, email identity or guest send resources are defined. The template is restricted to the existing configuration set by `AllowedValues`. AWS `cloudformation.ValidateTemplate` returned successfully in `us-east-1` with the two expected parameters; this validates syntax, **not** resource-level execution or IAM capability.

**Important:** this is not an enabled SNS consumer. A separate staged, least-privilege queue consumer must parse the full SNS envelope, call `createSnsNotificationVerifier` with the exact new topic ARN, and only then reconcile to the authoritatively matched outbox using `reconcileAuthenticatedSesFeedback`. The template must be reviewed and its deployment separately authorised before creating SES/SNS/SQS resources or changing the existing SES configuration set. A verified staging E2E send/delivery/bounce/complaint test and alerts/operations sign-off are still outstanding.

## Staging SQS feedback worker library (3 November 2026)

`services/booking-api/booking-ses-feedback-sqs-handler.mjs` connects the existing SNS signature verifier to SES feedback/outbox reconciliation. The handler can only operate with explicit staging opt-in, `AWS_REGION=us-east-1`, exact approved SQS and SNS ARNs for AWS account `145608514666`, the existing staging booking-table name, and a separately selected `BOOKING_TABLE_REGION=eu-west-2`. It constructs an explicitly regional DynamoDB document client, never a guest-email sender. Cross-region is deliberate: the SQS consumer must run alongside the queue in `us-east-1`, while the existing staging booking table resides in `eu-west-2`.

The consumer validates the complete SQS event source, ARN, batch size, message IDs and size *before* reading any payload. It receives SNS messages with `RawMessageDelivery=false`, calls the cryptographic `createSnsNotificationVerifier` for the pinned topic and then calls `reconcileAuthenticatedSesFeedback` to conditionally update only the corresponding email-outbox record. The Lambda partial batch failure response reports individual failed SQS message identifiers. The event-source mapping must enable `ReportBatchItemFailures` when deployed; without it, Lambda would not apply per-message retry semantics. Errors do not dump customer content. No event-source mapping, queue, SNS consumer Lambda or IAM write permissions have been deployed.

Network-free tests cover exact AWS region/source selection, default-disabled behaviour, verification callback wiring, partial failure reporting, malformed envelopes, and no access to storage for misrouted events. For staging deployment: provision the approved standalone SES/SNS/SQS feedback stack, attach a restricted `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` poller role and `dynamodb:GetItem/UpdateItem` rights scoped to the existing staging table only, set the exact ARNs, enable partial batch responses, and run controlled delivery/bounce/complaint acceptance. No production email or payment capabilities should be granted to this worker.

## Owner-approved SES feedback deployment — 3 November 2026

The owner explicitly approved **deployment in AWS account 145608514666, us-east-1**. The initial `les-buttes-ses-feedback-staging` CloudFormation CREATE failed property validation (`SNSDestination` instead of CloudFormation's required `SnsDestination`); AWS `DescribeEvents` showed the precise invalid nested property. The rolled-back stack was deleted and the corrected template (lowercase `SnsDestination`, uppercase `DELIVERY`, `BOUNCE`, `COMPLAINT`) was deployed successfully.

**Verified AWS stack status: `CREATE_COMPLETE`.** `GetConfigurationSetEventDestinations('my-first-configuration-set')` now returns an **enabled** `les-buttes-ses-feedback-staging` destination publishing these three events to `arn:aws:sns:us-east-1:145608514666:les-buttes-ses-feedback-staging`. The SNS subscription to `arn:aws:sqs:us-east-1:145608514666:les-buttes-ses-feedback-staging` is **confirmed**, the main SQS queue uses SQS-managed encryption and has a five-attempt redrive policy targeting `les-buttes-ses-feedback-staging-dlq`. CloudFormation output also confirms the SQS queue URL `https://sqs.us-east-1.amazonaws.com/145608514666/les-buttes-ses-feedback-staging`. No consumer Lambda/event source mapping has yet been deployed. No SES guest messages or payment actions were initiated.

A message was visible in the queue immediately after stack creation; **it has not been inspected or consumed**. Do not confuse the existence of that queue message with proof of a complete SES outbox-to-delivery journey. Before accepting LB-09, deploy the dedicated signature-verifying SQS consumer with least-privilege cross-region DynamoDB access, enable Lambda partial batch failures, and complete authorised staging delivery/bounce/complaint acceptance tests. The owner also approved retaining existing booking/business policy decisions as the baseline; explicit refund percentages and production go-live remain separate acceptance items.

## Isolated staging SQS worker deployment definition (3 November 2026)

The deployed SES/SNS/SQS feedback stack is verified `CREATE_COMPLETE`, but **the queue consumer has not been deployed**. To make the next step reviewable, `services/booking-api/staging-ses-feedback-worker.template.yaml` now defines a separate SAM stack in **us-east-1** containing only a Node.js 22 Lambda and an SQS event-source mapping. The worker entrypoint is `booking-ses-feedback-worker.handler`, invoking the signed-feedback processor that reads and conditionally updates the existing staging outbox in `eu-west-2`.

Safety restrictions: explicit `IsApprovedRegion` (US East), one exact approved SQS source/topic, one exact staging table name, `ReservedConcurrentExecutions: 2`, **event-source mapping `Enabled: false`**, and `FunctionResponseTypes: [ReportBatchItemFailures]` for future controlled activation. Inline IAM grants only `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` for the dedicated feedback queue and `dynamodb:GetItem/UpdateItem` on the existing staging booking table, not any payment, email send, general DynamoDB write, or production resource capability. Entry-point and template restrictions have network-free regression tests.

CloudFormation **ValidateTemplate succeeded** in `us-east-1` and reported `CAPABILITY_AUTO_EXPAND`. This does not mean a Lambda package has been built, that any IAM role has been created or that execution will succeed. Next: build SAM package, review resulting resources/change set and obtain explicit approval before deploying the worker and enabling the event-source mapping; then execute authenticated feedback processing acceptance. The SES feedback infrastructure deployment was authorised and completed previously; it did not itself authorise turning on a new Lambda consumer.
