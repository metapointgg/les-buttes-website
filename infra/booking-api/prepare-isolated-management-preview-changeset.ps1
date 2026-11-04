# LB-08: isolated management-only change set; NEVER executes or updates existing booking stack.
param(
 [string]$Profile='default',
 [string]$Region='eu-west-2',
 [string]$StackName='les-buttes-management-preview-isolated-staging',
 [switch]$Prepare
)
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2' -or $StackName -ne 'les-buttes-management-preview-isolated-staging'){
 throw 'Refusing non-isolated staging target.'
}
foreach($command in @('aws','sam')){
 if(-not(Get-Command $command -ErrorAction SilentlyContinue)){throw "Missing $command"}
}
$account=& aws sts get-caller-identity --profile $Profile --region $Region --query Account --output text
if($LASTEXITCODE -ne 0 -or $account -ne '145608514666'){throw 'Unexpected AWS account.'}
$existing=& aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json 2>$null
if($LASTEXITCODE -eq 0 -and $existing){throw 'Isolated management stack already exists; refusing UPDATE.'}
$old=& aws cloudformation describe-stacks --stack-name les-buttes-booking-staging --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Cannot inspect authoritative booking staging stack.'}
$source=@(($old|ConvertFrom-Json).Stacks)[0]
if($source.StackStatus -ne 'UPDATE_COMPLETE'){throw 'Booking staging stack is not UPDATE_COMPLETE.'}
$master=& aws dynamodb describe-table --table-name les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Cannot inspect authoritative booking table.'}
$table=($master|ConvertFrom-Json).Table
if($table.TableStatus -ne 'ACTIVE' -or @($table.GlobalSecondaryIndexes|Where-Object {
 $_.IndexName -eq 'BookingRequestsIndex' -and $_.IndexStatus -eq 'ACTIVE'
}).Count -ne 1){throw 'Booking master/index not ACTIVE.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$template='services/booking-api/staging-management-preview-isolated.template.yaml'
Write-Host 'Existing booking stack remains unchanged. JWT read-only management stack will be CREATE-only.'
if(-not $Prepare){Write-Host 'Read-only preflight passed. Use -Prepare to create a NON-EXECUTED change set.';return}
# Fail before any packaging/upload if the designated GitHub staging role cannot prepare/review.
$iamPreflight=Join-Path $PSScriptRoot 'check-isolated-management-preview-iam.ps1'
& $iamPreflight -Profile $Profile -Region $Region
if(-not $?){throw 'IAM preflight did not succeed; refusing packaging and change-set creation.'}
Push-Location $root
try{
 & sam validate --lint --template-file $template
 if($LASTEXITCODE -ne 0){throw 'SAM lint failed.'}
 & sam build --template-file $template --build-dir .aws-sam/management-preview-isolated-build --profile $Profile --region $Region
 if($LASTEXITCODE -ne 0){throw 'SAM build failed.'}
 & sam package --template-file .aws-sam/management-preview-isolated-build/template.yaml --s3-bucket les-buttes-cottage-manag-artifacts-145608514666-eu-west-2 --s3-prefix booking-management-preview-isolated/sam --output-template-file .aws-sam/management-preview-isolated-packaged.yaml --profile $Profile --region $Region
 if($LASTEXITCODE -ne 0){throw 'SAM package failed.'}
 $name='lb08-management-isolated-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
 & aws cloudformation create-change-set --stack-name $StackName --change-set-name $name --change-set-type CREATE --template-body 'file://.aws-sam/management-preview-isolated-packaged.yaml' --parameters ParameterKey=StagingBookingTableName,ParameterValue=les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --profile $Profile --region $Region --description 'JWT GET-only isolated management stack; review only; NO execution' --output json
 if($LASTEXITCODE -ne 0){throw 'Change-set creation failed. Existing stack untouched.'}
 Write-Host "Prepared NON-EXECUTED, CREATE-only change set: $name"
 Write-Host 'Review all resources, IAM role, JWT issuer/audience, and GET-only routes before any execution.'
 Write-Host 'DO NOT EXECUTE automatically.'
}finally{Pop-Location}
