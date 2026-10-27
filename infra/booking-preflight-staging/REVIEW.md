# Les Buttes booking preflight: separate, read-only AWS foundation

This new stack is **not deployed** until a separate, reviewed changeset. It does **not** modify `les-buttes-booking-real-staging`, the existing shared booking master, the website's live API, or the management PWA.

## Safety design

- A brand-new Lambda `les-buttes-booking-preflight-staging` has **no API Gateway event, Lambda Function URL, or DynamoDB writes**. It may be invoked only by AWS principals already permitted to call Lambda.
- `EnablePrivatePreflight=false` is the default. `BOOKING_REAL_GUEST_WRITES=false` is not configurable.
- The role can only `GetItem`/`Query` the existing staging booking master. That includes the approved policy records and published price configuration.
- The role can retrieve one SSM SecureString at `/les-buttes/booking/staging/turnstile-siteverify-secret` and decrypt it with a dedicated KMS key, restricted by the exact SSM parameter ARN and SSM service encryption context.
- The stack adds a customer-managed KMS key and alias. This has a small ongoing AWS KMS cost even with the preflight flag disabled. The key is **Retain** on stack deletion.
- No secret value is stored in Git, CloudFormation parameters, Lambda environment variables, logs or user-facing responses.
- Before a usable test, an operator must supply an actual Cloudflare Turnstile secret as SSM SecureString **using this new KMS key** (AWS Console recommended; never paste it into a chat or a command line).
- The CMS booking-terms source is still DRAFT and empty. No terms are published. Without approved terms in DynamoDB the Lambda returns an unavailable response even if the preflight flag is enabled.

## Stage A: validate and build locally

From website repo root, PowerShell:

```powershell
$ErrorActionPreference='Stop'
git pull --ff-only
if($LASTEXITCODE -ne 0){throw 'Pull failed'}
npm test
if($LASTEXITCODE -ne 0){throw 'Tests failed'}
node --check services/booking-api/scripts/publish-cms-terms.mjs
if($LASTEXITCODE -ne 0){throw 'Publisher script syntax failed'}
sam validate --lint --template-file infra/booking-preflight-staging/template.yaml
if($LASTEXITCODE -ne 0){throw 'Invalid SAM template'}
sam build --template-file infra/booking-preflight-staging/template.yaml --build-dir .aws-sam/preflight-staging-build
if($LASTEXITCODE -ne 0){throw 'Preflight build failed'}
```

No AWS change occurs from these commands.

## Stage B: create a CloudFormation CREATE changeset ONLY (after Stage A)

Use existing deployment artifact bucket after confirming it is still the correct bucket.

```powershell
$Region='eu-west-2';$Profile='default'
$Stack='les-buttes-booking-preflight-staging'
$ChangeSet='review-private-preflight-foundation'
$Table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'
$Account=(aws sts get-caller-identity --region $Region --profile $Profile --query Account --output text).Trim()
if($LASTEXITCODE -ne 0 -or $Account -ne '145608514666'){throw 'Wrong account'}
sam package --template-file .aws-sam/preflight-staging-build/template.yaml --s3-bucket les-buttes-cottage-manag-artifacts-145608514666-eu-west-2 --s3-prefix booking-preflight-staging --output-template-file .aws-sam/preflight-staging-packaged.yaml --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Package failed'}
aws cloudformation create-change-set --stack-name $Stack --change-set-name $ChangeSet --change-set-type CREATE --template-body file://.aws-sam/preflight-staging-packaged.yaml --parameters ParameterKey=ExistingStagingTable,ParameterValue=$Table ParameterKey=EnablePrivatePreflight,ParameterValue=false ParameterKey=AllowedOrigin,ParameterValue=http://localhost:4321 ParameterKey=TurnstileHostname,ParameterValue=localhost --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset failed'}
aws cloudformation wait change-set-create-complete --stack-name $Stack --change-set-name $ChangeSet --region $Region --profile $Profile
if($LASTEXITCODE -ne 0){throw 'Changeset not ready'}
aws cloudformation describe-change-set --stack-name $Stack --change-set-name $ChangeSet --query "Changes[*].ResourceChange.{Action:Action,Type:ResourceType,Name:LogicalResourceId,Replacement:Replacement}" --output table --region $Region --profile $Profile
```

**Stop and review**. Expect a Lambda function, its log group, execution role, the dedicated KMS key and alias. No API Gateway, Lambda URL, SNS, SES, master-table mutation or permission for PutItem/UpdateItem/DeleteItem.

## Terms release protocol: not for use while DRAFT

The Pages CMS source is `src/data/booking-terms.json`. An operator must approve the actual English booking terms and cancellation text. Neither wording nor publication approval has happened.

The release utility `services/booking-api/scripts/publish-cms-terms.mjs` is **dry-run by default**, cannot produce a release plan for a DRAFT, and cannot release content unless:
- the CMS file is marked PUBLISHED with a **new version** and complete English policy wording;
- the computed digest has been reviewed separately and explicitly repeated as `--approved-digest=...`;
- the operator supplies the expected previous published version (0 for the first release);
- `--publish` is provided, `BOOKING_TERMS_RELEASE_AUTHORIZED=YES` is set, region is eu-west-2, and AWS STS confirms the expected account.
- the IAM principal has `dynamodb:TransactWriteItems`/conditional Put permission on the staging booking master. The **preflight Lambda never gets that permission**.

The utility atomically inserts a new immutable `CONFIG#booking-terms / VERSION#...` record and updates `CONFIG#booking-terms / CURRENT` with an optimistic version check. It does not publish text to the public website; a separate website display/version release is still required.

## Explicit remaining work

1. Editorial/legal approval of terms, and multilingual presentation aligned with the approved terms.
2. Review the private stack changeset and deploy only after approval; configure SSM SecureString in the AWS Console, encrypted with the stack's dedicated KMS key.
3. Use a genuine staging Turnstile widget with matching hostname/action, rather than synthetic tokens.
4. Separately enable the private preflight flag *only after* approved terms are stored and the secret exists; test via **direct Lambda invocation**, not a public API.
5. Design the final protected public API and idempotent booking writer as a separate resource, with rate limiting, retention and after-commit processing. Never give write permissions to this preflight Lambda.
