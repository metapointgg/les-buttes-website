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
