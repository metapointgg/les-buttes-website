# LB-08 – isolated DynamoDB booking-confirmation acceptance gate

## Scope and safety

The production-shaped payment confirmation transaction uses `UNIT#geranium` and `UNIT#honeysuckle` keys. **Never** run its synthetic booking data on the existing `les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK` table: that could collide with real availability.

The dedicated table is `les-buttes-lb08-staging-isolated-acceptance`, defined by `services/booking-api/lb08-isolated-acceptance-table.template.yaml`. It is a separate, disposable DynamoDB resource in `eu-west-2`, with `PK`/ `SK` keys, on-demand billing, and TTL. No application or production service may reference it. The template is **not deployed automatically**.

### Superseded change set – do not execute

The first preview on 3 November 2026 created change set `awscli-cloudformation-package-deploy-1793687930` for the **old, incompatible** table name. Do not execute it. Delete that old change set after reviewing its identity, then pull the corrected template (commit `e532b7a`) and create a new preview. Use only the newly reviewed change set. An old preview does not automatically pick up changes committed to Git.

### Operator deployment – only after explicit approval

From repository root, review the exact change set prior to execution:

```powershell
aws cloudformation deploy `
  --template-file services/booking-api/lb08-isolated-acceptance-table.template.yaml `
  --stack-name les-buttes-lb08-staging-isolated-acceptance `
  --region eu-west-2 `
  --no-execute-changeset
```

The above **creates a change set but does not execute it**. Inspect it in AWS CloudFormation, confirm the only new resource is the isolated DynamoDB table, and separately approve execution. Confirm account ID, name, and region. Never target the booking staging stack or production.

After an approved stack deployment, independently run DescribeTable against `les-buttes-lb08-staging-isolated-acceptance`. Do not substitute another table if deployment fails.

### Acceptance criteria (not yet executed)

1. Seed synthetic `BOOKING#<UUID>` metadata, `PAYMENT#CHECKOUT`, and seven `UNIT#geranium` night holds exclusively in the isolated table.
2. Use a synthetic provider evidence fixture with £1 PAID checkout and one successful matching transaction; never reuse the real SumUp payment transaction ID for a persistent booking claim.
3. Execute `reconcileVerifiedPayment` with a mocked read-only checkout fetch (no new payment) and the isolated DynamoDB table.
4. Verify booking and seven holds transition atomically; transaction claim and audit record are present.
5. Attempt exact replay and verify no second audit or successful second confirmation.
6. Test invalid merchant, amount, stale hold and transaction mismatch without booking writes.
7. Remove the isolated stack only after verifying there are no dependencies, retaining test outcomes in issue #46.

**Status:** Infrastructure template prepared, no AWS deployment or booking-confirmation writes performed. Existing staging booking table and production remain untouched.

### Full synthetic booking-confirmation runner (prepared; not executed)

The isolated CloudFormation table is now deployed and ACTIVE. The acceptance runner is `services/booking-api/lb08-isolated-booking-acceptance.mjs`. It is **disabled by default**, requires the exact isolated table name and deliberately uses a synthetic provider response rather than creating another SumUp payment.

Once CI for the runner passes, run from `services/booking-api` using:

```powershell
$env:AWS_REGION = 'eu-west-2'
$env:BOOKING_ENVIRONMENT = 'staging'
$env:BOOKINGS_TABLE = 'les-buttes-lb08-staging-isolated-acceptance'
$env:LB08_ISOLATED_BOOKING_ACCEPTANCE = 'yes'
npm run probe:lb08:isolated-confirmation
```

The test seeds an artificial one-pound booking for seven nights in **2099**, with `UNIT#geranium` keys **only in the dedicated isolated table**, then invokes the actual `reconcileVerifiedPayment` implementation with a synthetic paid-checkout fixture and unique fake transaction identifier. It verifies the confirmed booking, seven nights without hold expiries, immutable transaction claim, single audit record and replay rejection using strongly consistent DynamoDB reads. It then attempts a conditional deletion of all synthetic records it owns.

**Do not substitute** the real staging booking table or the existing real SumUp sandbox transaction ID. On failure, inspect the isolated table for leftover `LB08_ISOLATED_ACCEPTANCE` items and avoid destroying the table until cleanup is verified. This test confirms transactional booking reconciliation with *simulated provider evidence*, not an independently paid guest booking.


### Confirmation safety boundary (3 November 2026)

The legacy host-only CLI command `node admin.mjs confirm` has been disabled. A manually supplied payment reference—even one prefixed `TEST-`—cannot establish payment. The only valid path to payment-based booking confirmation is `reconcileVerifiedPayment`, which independently fetches the provider checkout, verifies the single successful transaction, then atomically updates booking and reserved nights with a unique transaction claim. Do not re-enable manual confirmation as part of the staging deployment.

The confirmed synthetic DynamoDB acceptance runner does not itself deploy or expose a public payment callback. Deployed end-to-end checkout orchestration, secure triggering and guest communications remain separately gated.

### Approval / checkout separation (3 November 2026)

Owner approval is now a price-and-hold transition only. `executeOwnerTransition({action:'approve',approval:{amountPence}})` atomically sets the approved GBP amount and extends booking/cottage-night holds, but deliberately **does not store, send or require a payment URL**. A supplied `approval.paymentUrl` is rejected. The separate checkout orchestration must independently obtain and register a sandbox checkout after this transition and must not expose the hosted payment URL before successful durable registration. Approval POST remains disabled with HTTP 503 in the staging admin handler; no public payment route is enabled by this change. On approval-to-checkout failures, reconcile the creation claim and owner-reviewed booking before sharing links; do not mark any booking confirmed without the verified payment transaction.

### Owner approval HTTP preparation (3 November 2026)

The staging admin handler now supports an explicitly approved, amount-in-pence POST to `/admin/bookings/{bookingId}/actions/approve` **only** if both `MANAGEMENT_WRITES_ENABLED=true` and the separate `MANAGEMENT_APPROVAL_ENABLED=true` flag are configured, the request comes through a verified owner Cognito access token, and `BOOKING_ENVIRONMENT=staging`. The approval payload is strictly `{ "approved": true, "amountPence": 25000, "priceChangeReason": "Optional audit reason" }`. The writer independently checks the booking quote, hold and state and uses a conditional transaction. No guest-supplied checkout URL is accepted, no checkout is created, and no guest email is sent. Approval remains **disabled by default** because the new flag has not been enabled in AWS deployment configuration. Do not enable until staging route authorisation, API Gateway integration and owner workflow testing are complete.
