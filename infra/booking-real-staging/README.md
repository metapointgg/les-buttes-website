# Real guest staging foundation (disabled)

Separate from the existing synthetic API, guest-facing website, management PWA and production stacks.

Resources: dedicated rotating KMS key (retained on stack deletion), KMS alias, least-privilege Lambda role, 14-day log group and a Lambda that **always returns 403**. No API Gateway, Function URL, public trigger, DynamoDB write permission, KMS decrypt, SES or real guest persistence.

## Review before any deployment

From the repository root, PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$Region = 'eu-west-2'
$Profile = 'default'
$Account = (aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $Account -ne '145608514666') { throw 'Wrong AWS account' }
sam validate --lint --template-file infra/booking-real-staging/template.yaml
if ($LASTEXITCODE -ne 0) { throw 'SAM template invalid' }
sam build --template-file infra/booking-real-staging/template.yaml --build-dir .aws-sam/real-guest-build
if ($LASTEXITCODE -ne 0) { throw 'SAM build failed' }
$Bucket = 'les-buttes-cottage-manag-artifacts-145608514666-eu-west-2'
sam package --template-file .aws-sam/real-guest-build/template.yaml --s3-bucket $Bucket --s3-prefix booking-real-staging --output-template-file .aws-sam/real-guest-packaged.yaml --region $Region --profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
aws cloudformation create-change-set --stack-name les-buttes-booking-real-staging --change-set-name real-guest-foundation-review --change-set-type CREATE --template-body file://.aws-sam/real-guest-packaged.yaml --parameters ParameterKey=ExistingStagingTable,ParameterValue=les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK ParameterKey=EnableRealGuestWrites,ParameterValue=false --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $Region --profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'Changeset creation failed' }
aws cloudformation wait change-set-create-complete --stack-name les-buttes-booking-real-staging --change-set-name real-guest-foundation-review --region $Region --profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'Changeset failed' }
aws cloudformation describe-change-set --stack-name les-buttes-booking-real-staging --change-set-name real-guest-foundation-review --query 'Changes[*].ResourceChange.{Action:Action,Resource:LogicalResourceId,Type:ResourceType}' --output table --region $Region --profile $Profile
```

**STOP after displaying the changeset.** Do not execute it without reviewing the rendered change details, IAM role, KMS key policy and stack separation. KMS keys incur costs, and the key is retained on stack deletion.

The supplied stack cannot enable real writes: the only accepted parameter value is `false`. Later phases must introduce a separate authenticated private read API, policy acceptance, rate limiting, concurrency-safe atomic holds, retention management and payment reconciliation before any real guest data is accepted.
