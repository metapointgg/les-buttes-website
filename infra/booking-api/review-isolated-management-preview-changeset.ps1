# LB-08: inspect only CREATE-only isolated management CloudFormation change sets.
# The AWS query omits sensitive parameters, stack template and secret values.
param(
 [Parameter(Mandatory=$true)][string]$ChangeSetName,
 [string]$Profile='default',
 [string]$Region='eu-west-2',
 [string]$StackName='les-buttes-management-preview-isolated-staging'
)
$ErrorActionPreference='Stop'
if($Region -cne 'eu-west-2' -or
   $StackName -cne 'les-buttes-management-preview-isolated-staging' -or
   $ChangeSetName -cnotmatch '^lb08-management-isolated-[0-9]{14}$'){
 throw 'Refusing unexpected account region, isolated stack or change-set name.'
}
foreach($cmd in @('aws','node')){
 if(-not(Get-Command $cmd -ErrorAction SilentlyContinue)){throw "Missing $cmd"}
}
$account=& aws sts get-caller-identity --profile $Profile --region $Region --query Account --output text
if($LASTEXITCODE -ne 0 -or $account -ne '145608514666'){throw 'Unexpected AWS account.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reviewer=Join-Path $root 'services\booking-api\lb08-isolated-management-review-cli.mjs'
if(-not(Test-Path $reviewer)){throw 'Missing isolated management reviewer.'}
# Only pass status + changes; no secret-bearing parameters are retrieved.
$projected=& aws cloudformation describe-change-set --stack-name $StackName --change-set-name $ChangeSetName --profile $Profile --region $Region --query '{Status:Status,ExecutionStatus:ExecutionStatus,Changes:Changes}' --output json
if($LASTEXITCODE -ne 0){throw 'Unable to read proposed isolated-stack changes.'}
$projected | & node $reviewer
if($LASTEXITCODE -ne 0){throw 'Isolated management change set failed security review. DO NOT EXECUTE.'}
Write-Host 'Only expected read-only management additions found; manual IAM/JWT review still mandatory.'
Write-Host 'This command never executes the change set.'
