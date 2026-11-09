# LB-08: inspect a prepared staging change set. Never execute it.
# Uses AWS --query projection to avoid exposing parameter values / NoEcho secrets.
param(
 [Parameter(Mandatory=$true)][string]$ChangeSetName,
 [string]$Profile='default',
 [string]$Region='eu-west-2',
 [string]$StackName='les-buttes-booking-staging'
)
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2' -or $StackName -ne 'les-buttes-booking-staging' -or
   $ChangeSetName -notmatch '^lb08-management-review-[0-9]{14}$'){
 throw 'Only a named LB-08 staging management preview may be inspected.'
}
$who=& aws sts get-caller-identity --profile $Profile --region $Region --query Account --output text
if($LASTEXITCODE -ne 0 -or $who -ne '145608514666'){throw 'Unexpected AWS account.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reviewer=Join-Path $root 'services\booking-api\lb08-management-changeset-review-cli.mjs'
if(-not(Test-Path $reviewer)){throw 'Checkout reviewer script missing.'}
# Important: output projection excludes stack parameters, credentials and full templates.
$json=& aws cloudformation describe-change-set --stack-name $StackName --change-set-name $ChangeSetName --profile $Profile --region $Region --query '{Status:Status,ExecutionStatus:ExecutionStatus,Changes:Changes}' --output json
if($LASTEXITCODE -ne 0){throw 'Cannot describe the review change set.'}
$json | & node $reviewer
if($LASTEXITCODE -ne 0){
 throw 'Change set contains unsafe or unreviewed changes. DO NOT EXECUTE.'
}
Write-Host 'Only anticipated read-only management additions seen. Manual architectural/IAM review is still mandatory.'
Write-Host 'No CloudFormation execution has occurred.'
