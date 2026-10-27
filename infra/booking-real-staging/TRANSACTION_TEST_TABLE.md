# Isolated DynamoDB transaction integration test

This is a **separate DynamoDB table**. Do not alter the existing staging booking master or the disabled real-guest Lambda.

The harness `services/booking-api/test/integration-transaction.mjs` uses deliberately synthetic contact details and *mock ciphertext*, not AWS KMS. AWS KMS encrypt was verified independently using a synthetic marker. It does **not** verify the deployed Lambda IAM role. Never substitute real guest data.

## 1. Create and inspect changeset only

PowerShell from the website repository root:

```powershell
$ErrorActionPreference='Stop'
$Region='eu-west-2'
$Profile='default'
$Stack='les-buttes-booking-transaction-test'
$Name='synthetic-transaction-table-review'
$Account=(aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if($LASTEXITCODE -ne 0 -or $Account -ne '145608514666'){throw 'Unexpected AWS account'}
aws cloudformation validate-template --template-body file://infra/booking-real-staging/integration-table.yaml --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Invalid template'}
aws cloudformation create-change-set --stack-name $Stack --change-set-name $Name --change-set-type CREATE --template-body file://infra/booking-real-staging/integration-table.yaml --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset failed'}
aws cloudformation wait change-set-create-complete --stack-name $Stack --change-set-name $Name --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset preparation failed'}
aws cloudformation describe-change-set --stack-name $Stack --change-set-name $Name --query "Changes[*].ResourceChange.{Action:Action,Resource:LogicalResourceId,Type:ResourceType}" --output table --region $Region --profile $Profile
```

**STOP for review.** Expect **one** DynamoDB table with on-demand billing, TTL and encryption at rest; no other resource changes. This table has no GSI, no connected API or consumer, no integration with existing bookings.

## 2. After separate approval and table creation

Read the output `SyntheticTransactionTableName`. Only use credentials that are authorized for DynamoDB transactions on this disposable table, and verify the table is empty before any test. Do NOT grant write privileges to the deployed disabled guest Lambda to run this harness.

```powershell
$env:BOOKING_ENVIRONMENT='staging'
$env:BOOKING_REAL_GUEST_WRITES='false'
$env:AWS_PROFILE='default'
$env:AWS_REGION='eu-west-2'
$env:SYNTHETIC_TRANSACTION_TABLE=(aws cloudformation describe-stacks --stack-name les-buttes-booking-transaction-test --region eu-west-2 --profile default --query "Stacks[0].Outputs[?OutputKey=='SyntheticTransactionTableName'].OutputValue | [0]" --output text).Trim()
if($LASTEXITCODE -ne 0 -or $env:SYNTHETIC_TRANSACTION_TABLE -notmatch '^les-buttes-booking-transaction-test-'){throw 'Wrong isolated table'}
node services/booking-api/test/integration-transaction.mjs
if($LASTEXITCODE -ne 0){throw 'Transaction integration test failed: inspect isolated table; do not rerun blindly'}
```

The script asserts the test table is empty, writes 17 conditional items, retries the same request idempotently, attempts a conflicting 17-item transaction, proves no partial records from the conflict, then removes only test-owned items with additional conditional checks. A failed cleanup must be inspected before reuse. TTL is best effort, not an immediate cleanup mechanism.

The script does not exercise the separate KMS-encryption path nor data handling under a Lambda role; those are later tests.
