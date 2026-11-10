# Prepare ONLY a staging CloudFormation change set; NEVER execute it.
# Preserves every existing CloudFormation parameter using UsePreviousValue, including NoEcho secrets.
param([string]$Profile='default',[string]$Region='eu-west-2',[string]$StackName='les-buttes-booking-staging')
$ErrorActionPreference='Stop'
if($StackName -ne 'les-buttes-booking-staging' -or $Region -ne 'eu-west-2'){throw 'Refusing non-staging target.'}
foreach($tool in @('aws','sam')){if(-not(Get-Command $tool -ErrorAction SilentlyContinue)){throw "Missing $tool"}}
$whoJson=& aws sts get-caller-identity --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0 -or ($whoJson|ConvertFrom-Json).Account -ne '145608514666'){throw 'Unexpected AWS account.'}
$stackJson=& aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Could not inspect existing staging booking stack.'}
$existing=($stackJson|ConvertFrom-Json).Stacks[0]
if($existing.StackStatus -notmatch '^(CREATE|UPDATE)_COMPLETE$'){throw "Stack status not safe: $($existing.StackStatus)"}
$parameters=@($existing.Parameters)
foreach($p in @('BookingEnvironment','BookingRequestsEnabled','CalendarMonitorEnabled')){
    $v=@($parameters|Where-Object {$_.ParameterKey -eq $p})[0].ParameterValue
    $expect=if($p -eq 'BookingEnvironment'){'staging'}else{'true'}
    if($v -ne $expect){throw "$p is not $expect; cannot safely preserve this stack."}
}
foreach($p in @('BookingRequestsIndexEnabled','ManagementPreviewEnabled')){
    $v=@($parameters|Where-Object {$_.ParameterKey -eq $p})
    if($v.Count -gt 0 -and $v[0].ParameterValue -eq 'true'){throw "$p already enabled; do not use one-time index creation procedure."}
}
$resJson=& aws cloudformation describe-stack-resources --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Could not inspect stack resources.'}
$table=@(($resJson|ConvertFrom-Json).StackResources|Where-Object {$_.LogicalResourceId -eq 'BookingTable' -and $_.ResourceType -eq 'AWS::DynamoDB::Table'})
if($table.Count -ne 1 -or $table[0].PhysicalResourceId -ne 'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'){throw 'Existing booking table does not match the confirmed booking master.'}
$descJson=& aws dynamodb describe-table --table-name $table[0].PhysicalResourceId --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Could not inspect booking master.'}
$desc=($descJson|ConvertFrom-Json).Table
if($desc.TableStatus -ne 'ACTIVE' -or @($desc.GlobalSecondaryIndexes|Where-Object {$_.IndexName -eq 'BookingRequestsIndex'}).Count -gt 0){throw 'Index is already present or booking master not ACTIVE.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $root
try {
    & sam build --template-file infra/booking-api/template.yaml --profile $Profile --region $Region
    if($LASTEXITCODE -ne 0){throw 'SAM build failed.'}
    & sam package --template-file .aws-sam/build/template.yaml --resolve-s3 --output-template-file .aws-sam/booking-index-packaged.yaml --profile $Profile --region $Region
    if($LASTEXITCODE -ne 0){throw 'SAM packaging failed.'}
    $changeSetName="booking-index-review-"+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
    $newParameters=@()
    foreach($parameter in $parameters){
        if($parameter.ParameterKey -in @('BookingRequestsIndexEnabled','ManagementPreviewEnabled')){continue}
        $newParameters+=@{ParameterKey=$parameter.ParameterKey;UsePreviousValue=$true}
    }
    $newParameters+=@{ParameterKey='BookingRequestsIndexEnabled';ParameterValue='true'}
    $newParameters+=@{ParameterKey='ManagementPreviewEnabled';ParameterValue='false'}
    $paramFile=Join-Path ([IO.Path]::GetTempPath()) ("lb-index-params-"+[Guid]::NewGuid().ToString('N')+".json")
    [IO.File]::WriteAllText($paramFile,($newParameters|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding $false))
    try{
        & aws cloudformation create-change-set --stack-name $StackName --change-set-name $changeSetName --change-set-type UPDATE --template-body 'file://.aws-sam/booking-index-packaged.yaml' --parameters "file://$paramFile" --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --description 'Review existing-table index addition only - preserve credentials, monitoring and guest API' --profile $Profile --region $Region --output json
        if($LASTEXITCODE -ne 0){throw 'Unable to create review change set.'}
    }finally{
        Remove-Item $paramFile -ErrorAction SilentlyContinue
    }
    Write-Host "Change set PREPARED (not executed): $changeSetName"
    Write-Host 'Wait until CREATE_COMPLETE, then review ALL actions, replacements, resource properties and sensitive dynamic references in AWS before executing.'
    Write-Host 'REJECT if BookingTable Replacement is not False, or any unrelated Lambda, API, role, monitor, SSM or Cognito change is proposed.'
    Write-Host 'EXISTING BOOKINGS AND STACK NOT MODIFIED.'
}finally{Pop-Location}
