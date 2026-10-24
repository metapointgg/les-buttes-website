# Safely deploy and test an ISOLATED staging booking stack.
# Requirements: AWS CLI v2, AWS SAM CLI, Node.js >=22, AWS profile with CloudFormation/SSM/Lambda/IAM/DynamoDB/API Gateway rights.
# Usage: powershell -File infra/booking-api/deploy-staging.ps1 -Profile my-aws-profile
param(
    [Parameter(Mandatory=$true)][string]$Profile,
    [string]$Region = 'eu-west-2',
    [string]$StackName = 'les-buttes-booking-staging',
    [switch]$SkipE2ETests,
    [switch]$EnableCalendarMonitoring,
    [string]$MonitorAlertEmail = ''
)
$ErrorActionPreference = 'Stop'
if ($StackName -notmatch 'staging') { throw 'Refusing a stack name without staging.' }
if ($Region -ne 'eu-west-2') { throw 'Use eu-west-2 for this Les Buttes test stack.' }
foreach ($cmd in @('aws','sam','node','npm')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is not installed or not on PATH" }
}

if($EnableCalendarMonitoring){
    if($MonitorAlertEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+
$config = Get-Content (Join-Path $root 'services\booking-api\config\staging-synthetic-2027.json') -Raw | ConvertFrom-Json
if ($config.rates.status -ne 'APPROVED_FOR_STAGING_TESTS') { throw 'Requires synthetic staging-only rates.' }
if (-not $config._warning.Contains('STAGING')) { throw 'Refusing an unlabelled rate file.' }

$identity = & aws sts get-caller-identity --profile $Profile --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw 'AWS identity lookup failed.' }
Write-Host "AWS account: $($identity.Account). Deployment restricted to stack $StackName ($Region)."
Write-Host 'This creates billable AWS resources, including DynamoDB point-in-time recovery.'
$choice = Read-Host 'Type DEPLOY-STAGING to continue'
if ($choice -cne 'DEPLOY-STAGING') { throw 'Cancelled; no AWS resources changed.' }

function New-Token {
    [byte[]] $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$stagingToken=New-Token
$calendarToken=New-Token
$rulesName="/les-buttes/booking/staging/rules"
$ratesName="/les-buttes/booking/staging/rates"

function Put-SsmJson([string]$Name, $Data) {
    $json=ConvertTo-Json -InputObject $Data -Depth 15 -Compress
    $body=@{Name=$Name;Type='String';Value=$json;Overwrite=$true}
    $tmp=Join-Path ([System.IO.Path]::GetTempPath()) ("lb-ssm-"+[Guid]::NewGuid().ToString('N')+".json")
    $text=ConvertTo-Json -InputObject $body -Depth 5
    [System.IO.File]::WriteAllText($tmp,$text,(New-Object System.Text.UTF8Encoding $false))
    try {
        & aws ssm put-parameter --cli-input-json "file://$tmp" --profile $Profile --region $Region | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "SSM update failed: $Name" }
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}
Put-SsmJson $rulesName $config.rules
Put-SsmJson $ratesName $config.rates
Write-Host 'Synthetic minimum-stay rules and GBP prices written to staging SSM parameters.'

Push-Location $root
try {
    & sam build --template-file infra/booking-api/template.yaml --profile $Profile --region $Region
    if ($LASTEXITCODE -ne 0) { throw 'SAM build failed.' }
    $argsList=@(
      'deploy',
      '--template-file','.aws-sam/build/template.yaml',
      '--stack-name',$StackName,
      '--profile',$Profile,
      '--region',$Region,
      '--capabilities','CAPABILITY_IAM',
      '--resolve-s3',
      '--no-confirm-changeset',
      '--no-fail-on-empty-changeset',
      '--parameter-overrides',
      'BookingEnvironment=staging',
      'BookingRequestsEnabled=true',
      "BookingRulesJson=$rulesName",
      "BookingRatesJson=$ratesName",
      "StagingApiToken=$stagingToken",
      "CalendarToken=$calendarToken",
      'TurnstileSecret=1x0000000000000000000000000000000AA',
      "CalendarMonitorEnabled=$(if($EnableCalendarMonitoring){'true'}else{'false'})"
    )
    if($EnableCalendarMonitoring){
      $argsList+= "CalendarMonitorAlertEmail=$MonitorAlertEmail"
      Write-Host 'Enabling a billable AWS 4-hour Airbnb feed monitor, a small checkpoint DynamoDB table, and SNS email alert subscription.'
      Write-Host 'SNS will email a subscription confirmation link. Alerts are not delivered until you confirm it.'
    }else{
      Write-Host 'Automatic Airbnb calendar monitoring is disabled in this deployment.'
    }
    & sam @argsList
    if ($LASTEXITCODE -ne 0) { throw 'SAM deploy failed.' }
} finally { Pop-Location }

$stack = & aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Stack deployed but outputs could not be retrieved.' }
$apiUrl=($stack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'ApiUrl' }).OutputValue
$table=($stack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'BookingTableName' }).OutputValue
if (-not $apiUrl -or -not $table) { throw 'Missing staging stack outputs.' }

Write-Host "Staging stack deployed. API: $apiUrl"
Write-Host "Isolated booking table: $table"
Write-Host 'No production website or SumUp settings have been changed.'

if (-not $SkipE2ETests) {
    $env:AWS_PROFILE=$Profile
    $env:AWS_REGION=$Region
    $env:BOOKING_ENVIRONMENT='staging'
    $env:BOOKING_API_URL=$apiUrl
    $env:BOOKINGS_TABLE=$table
    $env:STAGING_API_TOKEN=$stagingToken
    Push-Location (Join-Path $root 'services\booking-api')
    try {
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Node dependency install failed.' }
        & node staging-e2e.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Staging E2E test failed; investigate the isolated staging database.' }
    } finally { Pop-Location }
    Write-Host 'Staging test completed; synthetic dates should have been released.'
}
Write-Host 'IMPORTANT: Staging API token is ephemeral. Rerun this script to rotate it and reconfigure the stack.'
Write-Host 'Do not add staging API details, credentials or tokens to GitHub, public Pages CMS, or production build environment.'
){throw 'Set -MonitorAlertEmail to the address where you will confirm SNS notifications.'}
    foreach($unit in @('geranium','honeysuckle')){
        $ssmName="/les-buttes/booking/staging/airbnb/$unit-url"
        $paramResult=& aws ssm describe-parameters --parameter-filters "Key=Name,Values=$ssmName" --profile $Profile --region $Region --output json | ConvertFrom-Json
        if($LASTEXITCODE -ne 0){throw "Unable to inspect $unit SecureString parameter."}
        $match=$paramResult.Parameters | Where-Object { $_.Name -eq $ssmName -and $_.Type -eq 'SecureString' }
        if(-not $match){throw "Missing encrypted $unit calendar feed in SSM. Run save-airbnb-url-staging.ps1 for this cottage first."}
    }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$config = Get-Content (Join-Path $root 'services\booking-api\config\staging-synthetic-2027.json') -Raw | ConvertFrom-Json
if ($config.rates.status -ne 'APPROVED_FOR_STAGING_TESTS') { throw 'Requires synthetic staging-only rates.' }
if (-not $config._warning.Contains('STAGING')) { throw 'Refusing an unlabelled rate file.' }

$identity = & aws sts get-caller-identity --profile $Profile --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw 'AWS identity lookup failed.' }
Write-Host "AWS account: $($identity.Account). Deployment restricted to stack $StackName ($Region)."
Write-Host 'This creates billable AWS resources, including DynamoDB point-in-time recovery.'
$choice = Read-Host 'Type DEPLOY-STAGING to continue'
if ($choice -cne 'DEPLOY-STAGING') { throw 'Cancelled; no AWS resources changed.' }

function New-Token {
    [byte[]] $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$stagingToken=New-Token
$calendarToken=New-Token
$rulesName="/les-buttes/booking/staging/rules"
$ratesName="/les-buttes/booking/staging/rates"

function Put-SsmJson([string]$Name, $Data) {
    $json=ConvertTo-Json -InputObject $Data -Depth 15 -Compress
    $body=@{Name=$Name;Type='String';Value=$json;Overwrite=$true}
    $tmp=Join-Path ([System.IO.Path]::GetTempPath()) ("lb-ssm-"+[Guid]::NewGuid().ToString('N')+".json")
    $text=ConvertTo-Json -InputObject $body -Depth 5
    [System.IO.File]::WriteAllText($tmp,$text,(New-Object System.Text.UTF8Encoding $false))
    try {
        & aws ssm put-parameter --cli-input-json "file://$tmp" --profile $Profile --region $Region | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "SSM update failed: $Name" }
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}
Put-SsmJson $rulesName $config.rules
Put-SsmJson $ratesName $config.rates
Write-Host 'Synthetic minimum-stay rules and GBP prices written to staging SSM parameters.'

Push-Location $root
try {
    & sam build --template-file infra/booking-api/template.yaml --profile $Profile --region $Region
    if ($LASTEXITCODE -ne 0) { throw 'SAM build failed.' }
    $argsList=@(
      'deploy',
      '--template-file','.aws-sam/build/template.yaml',
      '--stack-name',$StackName,
      '--profile',$Profile,
      '--region',$Region,
      '--capabilities','CAPABILITY_IAM',
      '--resolve-s3',
      '--no-confirm-changeset',
      '--no-fail-on-empty-changeset',
      '--parameter-overrides',
      'BookingEnvironment=staging',
      'BookingRequestsEnabled=true',
      "BookingRulesJson=$rulesName",
      "BookingRatesJson=$ratesName",
      "StagingApiToken=$stagingToken",
      "CalendarToken=$calendarToken",
      'TurnstileSecret=1x0000000000000000000000000000000AA'
    )
    & sam @argsList
    if ($LASTEXITCODE -ne 0) { throw 'SAM deploy failed.' }
} finally { Pop-Location }

$stack = & aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Stack deployed but outputs could not be retrieved.' }
$apiUrl=($stack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'ApiUrl' }).OutputValue
$table=($stack.Stacks[0].Outputs | Where-Object { $_.OutputKey -eq 'BookingTableName' }).OutputValue
if (-not $apiUrl -or -not $table) { throw 'Missing staging stack outputs.' }

Write-Host "Staging stack deployed. API: $apiUrl"
Write-Host "Isolated booking table: $table"
Write-Host 'No production website or SumUp settings have been changed.'

if (-not $SkipE2ETests) {
    $env:AWS_PROFILE=$Profile
    $env:AWS_REGION=$Region
    $env:BOOKING_ENVIRONMENT='staging'
    $env:BOOKING_API_URL=$apiUrl
    $env:BOOKINGS_TABLE=$table
    $env:STAGING_API_TOKEN=$stagingToken
    Push-Location (Join-Path $root 'services\booking-api')
    try {
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Node dependency install failed.' }
        & node staging-e2e.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Staging E2E test failed; investigate the isolated staging database.' }
    } finally { Pop-Location }
    Write-Host 'Staging test completed; synthetic dates should have been released.'
}
Write-Host 'IMPORTANT: Staging API token is ephemeral. Rerun this script to rotate it and reconfigure the stack.'
Write-Host 'Do not add staging API details, credentials or tokens to GitHub, public Pages CMS, or production build environment.'
