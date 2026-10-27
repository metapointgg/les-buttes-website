# Private Lambda KMS + DynamoDB transaction integration

The existing `les-buttes-booking-real-staging` stack is already deployed. This change upgrades its Lambda code but does not create a public route. It leaves `BOOKING_REAL_GUEST_WRITES=false` and retains **zero DynamoDB write privileges on the shared staging booking master**.

The private integration function accepts only the event `{"operation":"SYNTHETIC_PRIVATE_INTEGRATION_TEST"}` and only if a **separate feature flag** is deliberately enabled. It uses **hard-coded dummy guest details**, the pre-existing KMS key and the dedicated disposable DynamoDB table. KMS produces genuine ciphertext; the test writes 17 conditional items, retries identically, rejects an overlapping booking, verifies no partial records, and cleans up by booking ID.

## Stage A — build and create update changeset, with test DISABLED

Do NOT execute until reviewing the changeset. Run from website repo root:

```powershell
$ErrorActionPreference='Stop'
$Region='eu-west-2';$Profile='default'
$Stack='les-buttes-booking-real-staging'
$ChangeSet='private-kms-transaction-review'
$TestTable=(aws cloudformation describe-stacks --stack-name les-buttes-booking-transaction-test --region $Region --profile $Profile --query "Stacks[0].Outputs[?OutputKey=='SyntheticTransactionTableName'].OutputValue | [0]" --output text).Trim()
if($LASTEXITCODE -ne 0 -or $TestTable -notmatch '^les-buttes-booking-transaction-test-SyntheticTransactionTable-[A-Za-z0-9]+$'){throw 'Unsafe test table'}
$Account=(aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if($LASTEXITCODE -ne 0 -or $Account -ne '145608514666'){throw 'Wrong account'}
npm test
if($LASTEXITCODE -ne 0){throw 'Tests failed'}
sam validate --lint --template-file infra/booking-real-staging/template.yaml
if($LASTEXITCODE -ne 0){throw 'Template invalid'}
sam build --template-file infra/booking-real-staging/template.yaml --build-dir .aws-sam/real-guest-build
if($LASTEXITCODE -ne 0){throw 'SAM build failed'}
sam package --template-file .aws-sam/real-guest-build/template.yaml --s3-bucket les-buttes-cottage-manag-artifacts-145608514666-eu-west-2 --s3-prefix booking-real-staging --output-template-file .aws-sam/private-integration-packaged.yaml --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'SAM package failed'}

# Preserve existing stack parameters; override the two new parameters explicitly.
aws cloudformation create-change-set --stack-name $Stack --change-set-name $ChangeSet --change-set-type UPDATE --template-body file://.aws-sam/private-integration-packaged.yaml --parameters ParameterKey=ExistingStagingTable,UsePreviousValue=true ParameterKey=EnableRealGuestWrites,UsePreviousValue=true ParameterKey=SyntheticTestTable,ParameterValue=$TestTable ParameterKey=EnablePrivateIntegrationTests,ParameterValue=false --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset failed'}
aws cloudformation wait change-set-create-complete --stack-name $Stack --change-set-name $ChangeSet --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset not ready'}
aws cloudformation describe-change-set --stack-name $Stack --change-set-name $ChangeSet --query "Changes[*].ResourceChange.{Action:Action,Resource:LogicalResourceId,Replacement:Replacement,Type:ResourceType}" --output table --region $Region --profile $Profile
```

STOP and review output. With the feature flag false, no DynamoDB write permissions should be granted and every Lambda invocation should continue to return HTTP 403. Check the processed template and IAM delta before executing.

## Stage B — later (only after separate review)

A separate CloudFormation UPDATE changeset can set `EnablePrivateIntegrationTests=true`. At that point its role can transact/delete/scan/get **only** the dedicated isolated table, and the Lambda can be invoked directly by an authorised AWS principal. Never grant those permissions to the shared booking master. Confirm the isolated table has zero records before invocation.

After a successful test, disable the flag again via reviewed changeset and verify the Lambda returns HTTP 403. No public API, guest emails, payments or customer PII are introduced.
