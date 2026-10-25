# INSPECTION ONLY — no CloudFormation changes, DynamoDB writes, or token output.
param([string]$Profile='default',[string]$Region='eu-west-2',[string]$StackName='les-buttes-booking-staging')
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2' -or $StackName -ne 'les-buttes-booking-staging'){throw 'This inspection is restricted to the existing staging stack.'}
$identity=& aws sts get-caller-identity --profile $Profile --region $Region --output json | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or $identity.Account -ne '145608514666'){throw 'Unexpected AWS identity; refusing staging inspection.'}
$raw=& aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Cannot read booking stack.'}
$stack=($raw|ConvertFrom-Json).Stacks[0]
if($stack.StackStatus -notmatch '^(CREATE|UPDATE)_COMPLETE$'){throw "Stack not ready: $($stack.StackStatus)"}
$resourcesRaw=& aws cloudformation describe-stack-resources --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Cannot inspect stack resources.'}
$tables=@(($resourcesRaw|ConvertFrom-Json).StackResources|Where-Object {$_.LogicalResourceId -eq 'BookingTable' -and $_.ResourceType -eq 'AWS::DynamoDB::Table'})
if($tables.Count -ne 1 -or $tables[0].PhysicalResourceId -ne 'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'){throw 'Staging table mismatch. No changes allowed.'}
$desc=& aws dynamodb describe-table --table-name $tables[0].PhysicalResourceId --profile $Profile --region $Region --output json | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Cannot inspect booking table.'}
Write-Host "Verified same booking table: $($tables[0].PhysicalResourceId), status $($desc.Table.TableStatus)"
Write-Host 'CloudFormation parameters (NAMES AND SAFE STATUS ONLY; no values):'
foreach($p in $stack.Parameters){
  $status=if($p.ParameterKey -in @('BookingEnvironment','BookingRequestsEnabled','CalendarMonitorEnabled','BookingRequestsIndexEnabled','ManagementPreviewEnabled')){$p.ParameterValue}else{'<preserve existing value>'}
  Write-Host "  $($p.ParameterKey): $status"
}
$gsi=@($desc.Table.GlobalSecondaryIndexes | Where-Object {$_.IndexName -eq 'BookingRequestsIndex'})
Write-Host "BookingRequestsIndex: $(if($gsi.Count){$gsi[0].IndexStatus}else{'NOT INSTALLED'})"
Write-Host 'NEXT: review SAM change set for BookingRequestsIndexEnabled=true, ManagementPreviewEnabled=false.'
Write-Host 'Keep all existing parameters and NoEcho values, and reject any plan replacing the existing BookingTable or changing existing booking API credentials.'
Write-Host 'READ ONLY: no AWS changes were made.'
