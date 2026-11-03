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

### Owner-only checkout registration staging gate

Added `registerApprovedBookingCheckout` in `booking-approved-checkout.mjs`. It reads the authoritative approved booking with a strongly consistent DynamoDB read; requires the exact website booking-staging table, owner subject, non-expired hold and `AWAITING_PAYMENT`; derives GBP pence from `approvedAmountGBP` and calls the existing provider-first, creation-claim-protected `createAndRegisterCheckout`. It refuses unregistered or mismatched checkout responses. No amount, reference, URL or merchant identity is accepted from the browser.

The admin HTTP route `POST /admin/bookings/{bookingId}/checkout/register` is drafted for verified owners. It accepts only `{}`, requires `writeEnabled()` and a distinct `checkoutEnabled()` flag, and returns an owner-only registration summary without emailing the guest. **The deployed handler intentionally has no `registerCheckout` dependency wired and no checkout gate enabled**. The route therefore remains HTTP 503 until separate deployment review, SumUp credential injection, IAM permissions, and staged end-to-end testing are completed. Never enable payment initiation just to exercise this draft route, and never point it to the isolated acceptance table or production.

### Checkout Lambda runtime dependency wiring (3 November 2026)

The staging-only admin handler now injects `registerCheckoutWithSandbox`, using `booking-checkout-runtime.mjs`. It will only attempt registration if **all** of the following runtime settings match: `BOOKING_ENVIRONMENT=staging`, `AWS_REGION=eu-west-2`, `MANAGEMENT_WRITES_ENABLED=true`, `MANAGEMENT_CHECKOUT_ENABLED=true`, and `BOOKINGS_TABLE` is an authoritative `les-buttes-booking-staging-BookingTable-...` name. The checkout feature flag remains **unset/disabled** in deployed configuration. No changes to API Gateway, CloudFormation, environment values or IAM have been made in this code-only task.

When separately enabled after deployment review, checkout registration loads the SumUp secret key and merchant code from staging SSM, verifies the merchant's authoritative `sandbox=true` and matching merchant identity before constructing the checkout client, then derives the payable amount via a strongly consistent booking read and uses the permanent checkout creation claim. It returns an owner-only summary, not a guest-facing payment link.

**Outstanding deployment prerequisites:** verify that the management Lambda execution role has *least-privilege* `ssm:GetParameter` for precisely `/les-buttes/staging/sumup/api-key` and `/les-buttes/staging/sumup/merchant-code`, appropriate `kms:Decrypt` where the SecureString uses a customer-managed key, and DynamoDB read/conditional-write/transaction permissions scoped to the actual staging booking table. Review outbound HTTPS connectivity, Cognito-protected API Gateway route, and the stage-specific feature flag. No permissions should be granted against the production table, and no checkout POST should be enabled until the acceptance path is independently reviewed.

### Deployment readiness inventory – 3 November 2026 (read-only AWS)

Account `145608514666`, region `eu-west-2`: public booking HTTP API `fxr11hvri9` has only `ANY /{proxy+}` with `AuthorizationType=NONE`, routed to Node `index.handler` in `les-buttes-booking-staging-BookingFunction-tzvgfNDVJF22`. It must **never** host checkout/approval/admin write routes. This Lambda does not have `MANAGEMENT_WRITES_ENABLED`, `MANAGEMENT_APPROVAL_ENABLED`, or `MANAGEMENT_CHECKOUT_ENABLED` in its inspected environment.

The existing `les-buttes-cottage-management` API `i2irz87c82` has JWT authorizer `q9ukxh` (Cognito issuer `https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa`; audience `2mjmimjh7oc8h00d4nngrc1akj`), but its current management function uses the **Python 3.13** runtime, not the Node booking administration handler. An existing JWT API does not by itself establish that an owner checkout route is safely integrated.

**Deployment blocker:** create or identify a dedicated staging Node 22 management Lambda with handler `booking-admin-http.handler` and exact validated Cognito issuer/client environment; attach only explicit JWT-protected routes to it, with least-privilege read/write DynamoDB and SSM permissions. Verify the route's integration target and stage flags with `evaluateOwnerPaymentDeployment` before allowing a disabled-feature staging deployment. IAM and API Gateway changes need a separately reviewed change set. Keep `MANAGEMENT_CHECKOUT_ENABLED` and notifications **false**, and do not expose an `ANY /{proxy+}` route for management writes. This code change is a *policy test and deployment gate only*, not infrastructure creation.

### Existing SAM management stack reused – 3 November 2026

Repository inspection clarified that `infra/booking-api/template.yaml` **already** defines a conditional `ManagementApi` with Cognito JWT, a `ManagementReadOnlyFunction`, and a `ManagementWriteFunction`. Those resources were *not present in the observed deployed AWS API inventory*, because the managed staging preview/write conditions have not been activated. Do not create a competing public management API or use the existing unauthenticated `BookingApi` proxy route.

The existing SAM template now exposes two independent string parameters, both defaulting to **false**: `ManagementApprovalEnabled` (injected only into the management writer) and `ManagementCheckoutEnabled` (controls creation of a separate `ManagementCheckoutFunction`, its dedicated IAM role and the explicitly JWT-authorised `POST /admin/bookings/{bookingId}/checkout/register` route). The checkout condition additionally requires the staging management preview, booking-request index and write gates. The checkout role is limited to the existing stack's booking table and the two exact staging SSM parameter paths; no broad DynamoDB or SSM permissions and no checkout route in the public booking function.

**Do not apply this SAM template to production or execute a CloudFormation change set yet.** A staging change set requires retaining all currently deployed stack parameters (especially `BookingRequestsIndexEnabled=true`) and reviewing the *full* change set for unexpected replacements and changes. Confirm IAM `ssm:GetParameter`, any SecureString KMS key requirements, runtime VPC internet egress, matching Cognito client/issuer and owner-group configuration. Set checkout and approval parameters to `false` for first infrastructure deployment. Changes to existing booking records are not part of this infrastructure task.

Repository CI runs `sam validate --lint --template-file infra/booking-api/template.yaml` as well as backend tests. A green CI result checks source validity, not CloudFormation execution, live integration identity or permissions.

### Live stack reconciliation before any change set (3 November 2026)

Read-only AWS inspection, account `145608514666`, region `eu-west-2`: CloudFormation stack `les-buttes-booking-staging` is `UPDATE_COMPLETE`; DynamoDB table `les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK` and its `BookingRequestsIndex` are both `ACTIVE`. The deployed stack's original template and current parameter list **do not include** the new `BookingRequestsIndexEnabled`, `ManagementPreviewEnabled`, or `ManagementWritesEnabled` parameters. This means an ordinary template update using default `BookingRequestsIndexEnabled=false` would be unsafe and could remove the active index. The existing calendar monitoring and booking requests parameters are both `true`.

The next preview must first reconcile all currently deployed CloudFormation parameters, using `UsePreviousValue` for unchanged parameters, preserving secrets without displaying them. Any proposed new-template update must explicitly set `BookingRequestsIndexEnabled=true` and both `ManagementApprovalEnabled=false` and `ManagementCheckoutEnabled=false`, preserve `CalendarMonitorEnabled=true` and `BookingRequestsEnabled=true`, and retain `BookingEnvironment=staging`. Use the pure helper `verifyStagingChangeSetPreflight` for fail-closed index/status/account checks. A green preflight is **not authorisation to execute** an update: inspect the actual transformed change set for DynamoDB resource replacement/deletion, Lambda or API Gateway changes, unexpected policy broadening and hidden modifications first.

**No change set created in this step**, because the deployed stack template differs materially from the repository template. Do not use `sam deploy` with template defaults or perform an update merely to test the new management resources.

### LB-08 management preview change-set preparation – 3 November 2026

The deployed original stack has 14 resources, with an unconditional, currently ACTIVE `BookingRequestsIndex`. The repository template adds new conditional index/management parameters. The management-preview change-set script is **`infra/booking-api/prepare-management-preview-changeset.ps1`**, not either legacy index-creation script. It reads the existing CloudFormation parameters, verifies expected account, stage and physical DynamoDB table, and requires the live index ACTIVE. Its parameter list retains every existing value by `UsePreviousValue=true` (including NoEcho tokens and calendar settings), sets `BookingRequestsIndexEnabled=true`, and prepares Cognito-protected **read-only management preview** with `ManagementWritesEnabled=false`, `ManagementApprovalEnabled=false`, `ManagementCheckoutEnabled=false`. The existing staging pool/client identifiers are specified explicitly.

From repository root, `powershell -File infra/booking-api/prepare-management-preview-changeset.ps1` (PowerShell 7 on Windows may use `pwsh -File`) executes **read-only preflight**, no SAM build or CloudFormation change set. After review, `powershell -File infra/booking-api/prepare-management-preview-changeset.ps1 -Prepare` validates/builds/packages staging SAM code and creates a **NON-EXECUTED** CloudFormation review change set. It does not deploy or execute. SAM packaging uploads artefacts to staging S3; `-Prepare` is therefore not a purely read-only action, but does not update running Lambda, DynamoDB or API resources. AWS CLI, SAM CLI and appropriate staging-profile permissions are required. `-Profile <configured-profile>` selects the account's AWS CLI profile. Avoid copying secret-bearing CloudFormation/API output into issue comments or chat.

Before any change-set execution, inspect **every** action and replacement flag. Reject any removal or replacement of the BookingTable or index; unexpected changes to public booking function, calendar monitoring or guest request API; any unexpected IAM enlargement; any unauthenticated admin route; or any attempt to enable management writes, approval or checkout. The script alone is not proof that a change set is safe to execute.

### Change-set inspection gate – 3 November 2026

Read-only AWS recheck confirmed account `145608514666`, staging stack `UPDATE_COMPLETE`, table and `BookingRequestsIndex` `ACTIVE`, existing booking requests and calendar monitor enabled, and **zero pending CloudFormation change sets**.

After a non-executed `lb08-management-review-YYYYMMDDHHMMSS` change set has been created with the guarded preparer, inspect it with:

`powershell -File infra/booking-api/review-management-preview-changeset.ps1 -ChangeSetName lb08-management-review-YYYYMMDDHHMMSS -Profile default`

This command reads CloudFormation's **projected** `Status`, `ExecutionStatus` and `Changes` fields only, excluding parameter values and secure tokens, then runs the fail-closed `lb08-management-changeset-review-cli.mjs` resource classifier. It rejects any BookingTable or other existing public API/monitoring resource modification, replacement or deletion, unexpected IAM or payment Lambda, any checkout/approval write resources, incomplete change sets, and anything except anticipated JWT read-only management additions. A clean result is only clearance for **manual review**, not permission to execute. It does not execute a change set.

If the review rejects an existing public booking Lambda modification, do not loosen the reviewer: investigate the package/template reconciliation and build a narrower infrastructure-only change set that leaves all current staging code and services unaltered.

### Review CLI Windows compatibility and validation – 3 November 2026

The `lb08-management-changeset-review-cli.mjs` executable entry-point detection uses `pathToFileURL(resolve(process.argv[1]))` rather than hand-building `file://` URLs, so PowerShell/Windows paths are handled correctly. Node child-process contract tests confirm success only for the narrowly anticipated additions and nonzero exit status for booking-table changes, malformed output or unexpectedly present parameter values; sensitive values must not be echoed. The separate PowerShell wrapper selects only status/execution status/resource changes from CloudFormation, not parameter values.

These changes validate the reviewer **only**. The existing full-stack SAM template may still propose unrelated public booking Lambda updates when packaged, and the live staging booking table must be protected. Do not claim the actual CloudFormation review has succeeded until a change set is created, described and inspected against the deployment policy. No change set or deployment has been made.

### LB-08 isolated management preview – no public-booking stack drift (3 November 2026)

The deployed staging stack's public booking Lambda and calendar monitoring must not be rebuilt merely to add management reads. A new, narrow template `services/booking-api/staging-management-preview-isolated.template.yaml` defines **only** a dedicated Node.js 22 management reader, a new Cognito JWT-protected HTTP API with GET `/admin/{proxy+}`, and its read-only IAM role. It references the existing staging booking table and BookingRequestsIndex by validated name, with only `dynamodb:GetItem` / `dynamodb:Query` permissions on that table and its index. It does not define, change or import BookingTable, BookingApi, calendar monitor, or public booking resources. The Lambda explicitly disables management writes, owner approval and checkout creation. CI now validates the isolated template and tests these restrictions.

Use `infra/booking-api/prepare-isolated-management-preview-changeset.ps1` (default: read-only preflight) to verify AWS account, the existing booking stack, table and ACTIVE index. After separate review, `-Prepare` builds/packages and creates a **CREATE-only, NON-EXECUTED** change set for the dedicated stack `les-buttes-management-preview-isolated-staging`; the existing booking stack is not updated. S3 build packaging writes artefacts, not running resources. Review the new API Gateway JWT authorizer, exact GET-only route, resulting execution role and all CloudFormation changes before any deployment.

This isolated stack intentionally supersedes the earlier full-stack management-preview change-set preparation approach for the initial READ-ONLY preview. Do not use `prepare-management-preview-changeset.ps1 -Prepare` against the existing booking stack unless separately justified and reviewed for unavoidable code drift. After the isolated read-only preview is proven, any management write/payment infrastructure must be reviewed in a separate controlled change.

### Corrected isolated SAM validation and CREATE-only preview policy (3 November 2026)

CI reported SAM `E2015` on the isolated management template: the default Cognito issuer failed its own `AllowedPattern` because the YAML single-quoted regular expression contained double-escaped dots. The regex now uses a single backslash to escape each period. A regression test checks the declared default against the actual regex and rejects a wrong region or spoofed host. The management SAM validation then passed on commit `4dba933`.

`lb08-isolated-management-changeset-review.mjs` is a new pure review policy specifically for the **CREATE-only** isolated management stack. It fails closed on missing resources, incomplete/unavailable change sets, any resource Modify/Remove/replacement, any public booking/database/monitoring/payment resource and unexpected IAM resource types. It only considers dedicated management API/Lambda and their expected supporting resources eligible for **manual inspection**. It does not execute or authorise a deployment. The existing full-stack change-set reviewer is not suitable for this separate stack.

### Isolated CREATE-only change-set inspection connected (3 November 2026)

Once a `lb08-management-isolated-YYYYMMDDHHMMSS` CloudFormation CREATE change set is prepared using `prepare-isolated-management-preview-changeset.ps1 -Prepare`, inspect it with:

`powershell -File infra/booking-api/review-isolated-management-preview-changeset.ps1 -ChangeSetName lb08-management-isolated-YYYYMMDDHHMMSS -Profile default`

The wrapper first verifies AWS account `145608514666`, `eu-west-2`, exact isolated-stack name and expected change-set name. It requests only `Status`, `ExecutionStatus` and `Changes` from CloudFormation, then invokes `lb08-isolated-management-review-cli.mjs`. The CLI handles PowerShell/Windows paths, rejects unprojected parameters or malformed responses, and fails on any change outside the CREATE-only read-management resource allowlist. Backend CI executes the CLI as an actual subprocess, including negative tests.

**A clean result is not permission to deploy.** A human must still inspect the actual JWT authorizer, GET-only methods and IAM statements against the SAM template. This step does not execute or create a change set. The intended next AWS action, after green CI and review of the package build, is a CREATE-only preview using `-Prepare`; there is no requirement to update the existing booking stack.

### Preview IAM approved; GitHub no-execute preview workflow prepared (3 November 2026)

The user confirmed attaching `IsolatedManagementPreviewChangeSetOnly` to `les-buttes-booking-private-staging-deploy`. Live IAM `ListRolePolicies` and `GetRolePolicy` confirm the exact policy statement exists. `SimulatePrincipalPolicy` confirms **allowed** for stack CREATE, CreateChangeSet, DescribeChangeSet, read-only existing stack DescribeStacks and scoped S3 object upload/read. `cloudformation:ExecuteChangeSet` remains **implicitDeny**. IAM simulation unexpectedly reports `implicitDeny` on the SAM transform pseudo-account ARN *despite* the exact `CreateChangeSet` transform statement present in the role policy; the simulator does not show a matching statement. The read-only PowerShell preflight now checks the attached exact transform statement instead; the real CloudFormation API must still enforce authorisation.

New GitHub Actions workflow `.github/workflows/lb08-isolated-management-preview.yml` is a dedicated **CREATE-only, NON-EXECUTING** staging preview. It assumes the existing branch-scoped GitHub staging role, verifies account and existing stack status, runs backend tests and SAM lint, builds actual Node.js Lambda code, checks packaged handler/dependencies, uploads SAM artefacts to `booking-management-preview-isolated/sam`, creates an isolated stack change set, waits for `CREATE_COMPLETE`, then runs the strict isolated reviewer CLI. **There is no ExecuteChangeSet or sam deploy in the workflow.** The live existing booking API/table/index are not defined as resources in this template. The workflow was corrected to avoid DynamoDB DescribeTable calls unsupported by the staging GitHub role; table/index status had been independently verified with read-only AWS credentials.

At the last read-only AWS check, there were **no S3 artefacts** under the isolated management prefix and **no isolated management stack**. Do not claim a change set has been created or validated until AWS exposes the actual change-set ARN and review output. The new workflow may require enabling/running it in GitHub Actions if a push does not start it automatically.
