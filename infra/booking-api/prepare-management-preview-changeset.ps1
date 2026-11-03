# LB-08: prepare a staging management infrastructure change set for REVIEW ONLY.
# Does not execute a change set, alter CloudFormation resources, or rotate secrets.
# Do NOT use the legacy index-creation scripts: BookingRequestsIndex already exists.
param(
  [string]$Profile = 'default',
  [string]$Region = 'eu-west-2',
  [string]$StackName = 'les-buttes-booking-staging',
  [string]$CognitoPoolId = 'eu-west-2_Wvo0I3cTa',
  [string]$CognitoClientId = '2mjmimjh7oc8h00d4nngrc1akj',
  [switch]$Prepare
)
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2' -or $StackName -ne 'les-buttes-booking-staging'){
  throw 'Refusing non-staging CloudFormation stack.'
}
if(-not(Get-Command aws -ErrorAction SilentlyContinue) -or
   -not(Get-Command sam -ErrorAction SilentlyContinue)){
  throw 'AWS CLI and SAM CLI must be installed.'
}
function Invoke-AwsJson([string[]]$Arguments) {
  $raw = & aws @Arguments --profile $Profile --region $Region --output json
  if($LASTEXITCODE -ne 0){throw 'AWS read failed; refusing change-set preparation.'}
  return ($raw | ConvertFrom-Json)
}
$who = Invoke-AwsJson -Arguments @('sts','get-caller-identity')
if($who.Account -ne '145608514666'){throw 'AWS account mismatch.'}
$stacks = Invoke-AwsJson -Arguments @('cloudformation','describe-stacks','--stack-name',$StackName)
$stack = @($stacks.Stacks)[0]
if($stack.StackName -ne $StackName -or $stack.StackStatus -ne 'UPDATE_COMPLETE'){
  throw 'Stack is not in the verified UPDATE_COMPLETE state.'
}
$existing = @($stack.Parameters)
$required = @{ BookingEnvironment='staging'; BookingRequestsEnabled='true'; CalendarMonitorEnabled='true' }
foreach($key in $required.Keys){
  $value=@($existing|Where-Object {$_.ParameterKey -eq $key})
  if($value.Count -ne 1 -or $value[0].ParameterValue -cne $required[$key]){
    throw "Unexpected deployed $key; refusing change-set preparation."
  }
}
$resources = Invoke-AwsJson -Arguments @('cloudformation','describe-stack-resources','--stack-name',$StackName)
$master = @($resources.StackResources|Where-Object {
  $_.LogicalResourceId -eq 'BookingTable' -and $_.ResourceType -eq 'AWS::DynamoDB::Table'
})
if($master.Count -ne 1 -or
   $master[0].PhysicalResourceId -ne 'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'){
  throw 'Staging booking-master identity mismatch.'
}
$tableResult=Invoke-AwsJson -Arguments @('dynamodb','describe-table','--table-name',$master[0].PhysicalResourceId)
$table=$tableResult.Table
$indexes=@($table.GlobalSecondaryIndexes|Where-Object {
  $_.IndexName -eq 'BookingRequestsIndex' -and $_.IndexStatus -eq 'ACTIVE'
})
if($table.TableStatus -ne 'ACTIVE' -or $indexes.Count -ne 1){
  throw 'Booking master or BookingRequestsIndex is not ACTIVE.'
}
if($CognitoPoolId -cne 'eu-west-2_Wvo0I3cTa' -or
   $CognitoClientId -cne '2mjmimjh7oc8h00d4nngrc1akj'){
  throw 'Expected staging management Cognito identity mismatch.'
}
# UsePreviousValue for every existing parameter, including NoEcho secrets.
# Explicitly supply new template parameters; no secret values are printed.
$newKeys=@{
  BookingRequestsIndexEnabled='true'
  ManagementPreviewEnabled='true'
  ManagementWritesEnabled='false'
  ManagementApprovalEnabled='false'
  ManagementCheckoutEnabled='false'
  ManagementCognitoPoolId=$CognitoPoolId
  ManagementCognitoClientId=$CognitoClientId
  ManagementAllowedOrigin='http://127.0.0.1:5173'
}
$parameters=@()
foreach($p in $existing){
  if($newKeys.ContainsKey($p.ParameterKey)){
    if($p.ParameterValue -cne $newKeys[$p.ParameterKey]){
      throw "Existing $($p.ParameterKey) differs from explicitly guarded value."
    }
  }else{
    $parameters+=@{ParameterKey=$p.ParameterKey;UsePreviousValue=$true}
  }
}
foreach($key in ($newKeys.Keys|Sort-Object)){
  $parameters+=@{ParameterKey=$key;ParameterValue=$newKeys[$key]}
}
Write-Host "Validated staging stack $StackName; table and BookingRequestsIndex ACTIVE."
Write-Host 'Plan: enable read-only JWT management preview; maintain existing booking requests and monitoring.'
Write-Host 'Owner management writes, approval and checkout creation remain DISABLED.'
Write-Host 'All existing parameter values (including NoEcho secrets) will be preserved.'
if(-not $Prepare){
  Write-Host 'Read-only preflight complete. Re-run with -Prepare to create a NON-EXECUTED change set.'
  return
}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $root
try{
  & sam validate --lint --template-file infra/booking-api/template.yaml
  if($LASTEXITCODE -ne 0){throw 'SAM template validation failed.'}
  & sam build --template-file infra/booking-api/template.yaml --profile $Profile --region $Region
  if($LASTEXITCODE -ne 0){throw 'SAM build failed.'}
  & sam package --template-file .aws-sam/build/template.yaml --resolve-s3 --profile $Profile --region $Region --output-template-file .aws-sam/lb08-management-review-packaged.yaml
  if($LASTEXITCODE -ne 0){throw 'SAM packaging failed.'}
  $file=Join-Path ([IO.Path]::GetTempPath()) ('lb08-management-review-'+[Guid]::NewGuid().ToString('N')+'.json')
  $name='lb08-management-review-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
  try{
    [IO.File]::WriteAllText($file,($parameters|ConvertTo-Json -Depth 5),(New-Object System.Text.UTF8Encoding $false))
    & aws cloudformation create-change-set --stack-name $StackName --change-set-name $name --change-set-type UPDATE --template-body 'file://.aws-sam/lb08-management-review-packaged.yaml' --parameters "file://$file" --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --description 'LB08 read-only Cognito management preview; preserve active index; payments and writes off; REVIEW ONLY' --profile $Profile --region $Region --output json
    if($LASTEXITCODE -ne 0){throw 'Change-set preparation failed; stack not updated.'}
  }finally{Remove-Item $file -ErrorAction SilentlyContinue}
  Write-Host "Change set created for REVIEW ONLY: $name"
  Write-Host 'DO NOT EXECUTE until every resource action/replacement, IAM role and public API impact is reviewed.'
  Write-Host 'REJECT if BookingTable is deleted/replaced, BookingRequestsIndex removed, monitor disabled, or checkout/write route enabled.'
}finally{Pop-Location}
