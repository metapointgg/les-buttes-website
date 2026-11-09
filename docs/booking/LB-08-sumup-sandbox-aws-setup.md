# LB-08 — Install SumUp sandbox credentials in AWS (owner action)

This is a manual **staging-only** setup guide. Never commit API secrets to GitHub, paste them into tickets/chats, or put them in CloudFormation parameter overrides.

## Parameter Store setup

In the AWS console choose region **eu-west-2**, then open **Systems Manager → Parameter Store → Create parameter**.

Create:

| Name | Tier | Type | Value |
|---|---|---|---|
| `/les-buttes/staging/sumup/api-key` | Standard | SecureString | The secret key for the **sandbox** merchant (must start with `sup_sk_test_` for current client) |
| `/les-buttes/staging/sumup/merchant-code` | Standard | String | Sandbox merchant code (not the public merchant display name) |

Use the AWS-owned SSM encryption key unless a customer-managed key and exact `kms:Decrypt` access are explicitly configured. Grant access only to the dedicated staging payment role. **Do not add these parameters to the existing read-only availability Lambda.** Do not enable payment-processing flags.

If the API key does not have the expected sandbox prefix, pause: the current client will reject it. Do not replace a live key with a test key or relax key validation.

## Safe non-secret verification

- Check both parameters **exist**, their names/types are correct, and the region is eu-west-2.
- Do not copy the SecureString value into a terminal, GitHub logs, ChatGPT or issue comments.
- Record only the parameter paths, merchant-code validation outcome, and whether SumUp Hosted Checkout is available to the sandbox merchant.
- Confirm merchant eligibility for **GBP online card payments for a Guernsey-based business** directly in SumUp merchant settings/support; account creation alone does not confirm this.

## Integration prerequisites

Next implementation phase is a *separately deployed staging payment Lambda* with least-privilege SSM parameter reads and DynamoDB transaction permissions. Credentials should be resolved at runtime from SSM with decryption, not passed in Lambda environment variables, public endpoints, or build arguments. SumUp must be queried independently before a booking is marked paid.

The IAM design is documented in `docs/booking/LB-08-staging-iam-deployment-gate.md`; the acceptance matrix is in `docs/booking/LB-08-staging-acceptance.md`.

## Go/no-go

Leave `PAYMENT_RECONCILIATION_ENABLED=false` and `PAYMENT_NOTIFICATIONS_ENABLED=false` until the dedicated AWS staging role and real SumUp sandbox tests have passed and activation is explicitly approved.

## Execute read-only sandbox connectivity probe (local operator)

After `npm ci` in `services/booking-api`, run the following **PowerShell** commands from a terminal with AWS credentials scoped to the staging account and permission to read exactly the two SSM parameters:

```powershell
$env:AWS_REGION = 'eu-west-2'
$env:BOOKING_ENVIRONMENT = 'staging'
$env:LB08_READONLY_SANDBOX_PROBE = 'yes'
# Set AWS_PROFILE only if your normal AWS identity requires it.
npm run probe:sumup:sandbox
```

Success is strictly redacted: `{"connected":true,"region":"eu-west-2","environment":"staging","merchantMatched":true}`. Failures print a generic message and return a non-zero exit code, so **do not paste any debug SDK logs or secret parameter values into tickets**. The command uses GET `/v0.1/me`, not POST; it does not create a checkout or charge a card.

This does **not** test GBP payment acceptance, confirm Hosted Checkout settlement, or perform a DynamoDB write. The staging operator must confirm the correct AWS account independently (e.g. `aws sts get-caller-identity`) and must not invoke this against production credentials. The command is manually invoked only; no CI workflow runs it.
