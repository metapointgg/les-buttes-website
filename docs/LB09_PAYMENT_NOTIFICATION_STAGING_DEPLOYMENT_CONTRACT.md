# LB-09 — Payment and guest-notification staging deployment contract

Status: **not accepted for end-to-end staging; production NO GO**.

## Current separation
- `staging-management-preview-isolated.template.yaml` is a **GET-only, read-only** Cognito-protected preview. It must not receive POST routes, DynamoDB transaction permissions, SumUp SSM access or SES send permissions. All payment and email flags are explicitly false.
- `booking-admin-http.mjs` contains an owner-only `POST /admin/bookings/{uuid}/payment/reconcile` handler. Source availability is **not** proof of a deployed route.
- The payment reconciler verifies SumUp independently, atomically confirms the booking, and the follow-up orchestrator may attempt a separate durable SES outbox send. SES acceptance is not guest delivery.

## Requirements before staging activation
1. Identify and review the **authorised canonical owner-management** API deployment and its actual API Gateway route configuration. Do not create a second owner app or modify the read-only preview.
2. Restrict POST reconciliation to Cognito owner JWT, eu-west-2, the exact staging BookingTable, and the existing staging-only feature gates. Require `{}` request body; never accept browser-supplied payment evidence.
3. Scope IAM narrowly: strongly consistent DynamoDB reads, transaction writes to the staging booking table only; SSM read access solely to the existing SumUp sandbox parameters. No production booking table access.
4. Keep `BOOKING_CONFIRMATION_DISPATCH_ENABLED=false` and `BOOKING_EMAILS_ENABLED=false` initially. Before SES activation, confirm the sender identity/DKIM, us-east-1 SES restrictions, verified test recipient allowlist and approved customer-facing wording. Grant SES permissions only to the approved sender/region.
5. Validate owner, admin and viewer authorisation; non-POST rejection; expired holds; provider unpaid/mismatched merchant/amount; transaction idempotency; and that checkout URLs or credentials are absent from responses.
6. With synthetic bookings only, verify approval → checkout registration → provider PAID → atomic confirmation → outbox claim → SES acknowledgement. Repeated reconciliation must not send a duplicate email. Simulate uncertain SES response and verify the outbox stays claimed, the booking stays confirmed, and manual reconciliation is required.
7. Record API Gateway route ID, deployed Lambda version, IAM policy review, CloudFormation change set, staging test evidence and go/no-go decision. Do not enable production or live guest email as part of this work.

## Safety invariant
A payment can be confirmed without an email being sent. An email must never be sent from an unconfirmed booking. A claimed outbox event must never be retried automatically after an uncertain send.

## Verified AWS inventory — 2026-11-05

Read-only AWS inspection, account 145608514666, eu-west-2:

- CloudFormation `les-buttes-cottage-management`: `UPDATE_COMPLETE`.
- Canonical HTTP API: `i2irz87c82`, route `ANY /{proxy+}` with `JWT` authorisation, plus existing mailing routes. This is **not** evidence that booking payment reconciliation is implemented.
- Canonical API Lambda: `les-buttes-cottage-management-ApiFunction-NtF6QjkvsE3v`, runtime **python3.13**, handler `app.handler`, last modified 2026-10-27 09:13:47 UTC.
- The canonical Lambda has `BOOKING_MASTER_*` settings, but no `MANAGEMENT_PAYMENT_RECONCILIATION_ENABLED`, `BOOKING_CONFIRMATION_DISPATCH_ENABLED` or `BOOKING_EMAILS_ENABLED` environment settings.
- The Node.js `services/booking-api/booking-admin-http.mjs` handler and its new payment route are **not** deployed as the canonical Python Lambda handler.

**Architecture decision required before deploying:** retain the canonical Python owner UI/API as the single owner app and integrate the Node.js booking service through an explicitly authorised, Cognito-protected staging route/integration. Do not replace the canonical Python Lambda, route all traffic to a new app, or enable write/SES flags in the read-only preview. Review the integration design and IAM/CloudFormation change set first.

## Verified canonical JWT authoriser — 2026-11-05

Read-only API Gateway inspection of `i2irz87c82` in eu-west-2 found JWT authoriser `q9ukxh` (`CognitoAuthorizer`), issuer `https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa`, audience `2mjmimjh7oc8h00d4nngrc1akj`. Existing `ANY /{proxy+}` and mailing routes use this authoriser. **No dedicated payment reconciliation route is installed.**

**Important:** The isolated management preview template uses a different Cognito audience (`1a0i42vp4gi24i5orh8i4jjhmr`). Do not copy that preview client ID into the canonical owner API integration. The Node.js `identityFromGateway` must receive the verified canonical issuer and client ID through its own staging environment settings. The review-only CloudFormation template still requires a reviewed immutable Lambda artefact, authoriser binding, IAM assessment and change-set preview before any deployment.
