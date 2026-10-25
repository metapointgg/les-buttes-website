# Prepare ONLY an in-place BookingRequestsIndex change set from the DEPLOYED template.
# No SAM build/package, no Lambda code updates, no credential rotation, no execution.
param([string]$Profile='default',[string]$Region='eu-west-2',[string]$StackName='les-buttes-booking-staging')
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2' -or $StackName -ne 'les-buttes-booking-staging'){throw 'Only the known staging stack is permitted.'}
$identityJson=& aws sts get-caller-identity --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0 -or ($identityJson|ConvertFrom-Json).Account -ne '145608514666'){throw 'Unexpected AWS account.'}
$stackJson=& aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Unable to read current stack.'}
$stack=($stackJson|ConvertFrom-Json).Stacks[0]
if($stack.StackStatus -notmatch '^(CREATE|UPDATE)_COMPLETE$'){throw 'Stack is not ready.'}
$resourcesJson=& aws cloudformation describe-stack-resources --stack-name $StackName --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Unable to read resource IDs.'}
$tables=@(($resourcesJson|ConvertFrom-Json).StackResources|Where-Object {$_.LogicalResourceId -eq 'BookingTable' -and $_.ResourceType -eq 'AWS::DynamoDB::Table'})
if($tables.Count -ne 1 -or $tables[0].PhysicalResourceId -ne 'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK'){throw 'Existing booking table mismatch.'}
$descriptionJson=& aws dynamodb describe-table --table-name $tables[0].PhysicalResourceId --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Could not verify DynamoDB status.'}
$table=($descriptionJson|ConvertFrom-Json).Table
if($table.TableStatus -ne 'ACTIVE' -or @($table.GlobalSecondaryIndexes|Where-Object {$_.IndexName -eq 'BookingRequestsIndex'}).Count -gt 0){throw 'Table/index not in expected pre-install state.'}
# Fetch the exact ORIGINAL deployed CloudFormation template, not the current repository SAM template.
$templateJson=& aws cloudformation get-template --stack-name $StackName --template-stage Original --profile $Profile --region $Region --output json
if($LASTEXITCODE -ne 0){throw 'Unable to fetch deployed template.'}
$template=($templateJson|ConvertFrom-Json).TemplateBody
if($template -isnot [string]){throw 'Expected deployed YAML template as a string; refusing conversion.'}
# Normalize Windows CRLF for deterministic anchored matching and insertion.
$template=$template.Replace("`r`n","`n")
$resourceMatch=[regex]::Match($template,'(?ms)^  BookingTable:[ \t]*\r?\n(?<content>.*?)(?=^  [A-Za-z][A-Za-z0-9]*:[ \t]*\r?$)')
if(-not $resourceMatch.Success){throw 'Could not uniquely locate BookingTable resource.'}
if([regex]::Matches($template,'(?m)^  BookingTable:[ \t]*$').Count -ne 1){throw 'Unexpected duplicate BookingTable definitions.'}
$original=$resourceMatch.Value
if($original -match 'GlobalSecondaryIndexes:|GSI1PK|GSI1SK'){throw 'Index attributes already present in deployed template.'}
if([regex]::Matches($original,'(?m)^      KeySchema:[ \t]*$').Count -ne 1 -or
   [regex]::Matches($original,'(?m)^      AttributeDefinitions:[ \t]*$').Count -ne 1 -or
   [regex]::Matches($original,'(?m)^      TimeToLiveSpecification:[ \t]*$').Count -ne 1){
    throw 'Unexpected BookingTable structure; manual review required.'
}
$new=$original
# Preserve the exact deployed template apart from these two insertions.
$new=$new -replace '(?m)^(      KeySchema:[ \t]*)$', @'
      - AttributeName: GSI1PK
        AttributeType: S
      - AttributeName: GSI1SK
        AttributeType: S
$1
'@
$new=$new -replace '(?m)^(      TimeToLiveSpecification:[ \t]*)$', @'
      GlobalSecondaryIndexes:
      - IndexName: BookingRequestsIndex
        KeySchema:
        - AttributeName: GSI1PK
          KeyType: HASH
        - AttributeName: GSI1SK
          KeyType: RANGE
        Projection:
          ProjectionType: INCLUDE
          NonKeyAttributes:
          - id
          - start
          - end
          - units
          - status
          - guests
          - requestedAt
$1
'@
if($new -eq $original){throw 'No changes produced.'}
$updated=$template.Substring(0,$resourceMatch.Index)+$new+$template.Substring($resourceMatch.Index+$resourceMatch.Length)
$parameters=@($stack.Parameters|ForEach-Object { @{ParameterKey=$_.ParameterKey;UsePreviousValue=$true} })
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$changeSet="booking-index-only-$stamp"
$templateFile=Join-Path ([IO.Path]::GetTempPath()) ("lb-deployed-index-"+[Guid]::NewGuid().ToString('N')+".yaml")
$paramsFile=Join-Path ([IO.Path]::GetTempPath()) ("lb-deployed-params-"+[Guid]::NewGuid().ToString('N')+".json")
$utf8=New-Object System.Text.UTF8Encoding($false)
try{
    [IO.File]::WriteAllText($templateFile,$updated,$utf8)
    [IO.File]::WriteAllText($paramsFile,($parameters|ConvertTo-Json -Depth 4),$utf8)
    & aws cloudformation create-change-set --stack-name $StackName --change-set-name $changeSet --change-set-type UPDATE --template-body "file://$templateFile" --parameters "file://$paramsFile" --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --description 'Existing deployed template plus BookingRequestsIndex only; do not execute without change review' --profile $Profile --region $Region --output json
    if($LASTEXITCODE -ne 0){throw 'Change set creation failed; AWS stack was not updated.'}
}finally{
    Remove-Item $templateFile,$paramsFile -ErrorAction SilentlyContinue
}
Write-Host "Prepared NOT EXECUTED: $changeSet"
Write-Host 'Review the complete change set. EXPECT ONLY BookingTable Modify Replacement False.'
Write-Host 'If ANY other resource changes, DO NOT EXECUTE.'
