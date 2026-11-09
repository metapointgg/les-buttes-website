# LB-08: read-only IAM preflight for GitHub staging preview identity.
# Only simulates permissions. NEVER modifies IAM, creates change sets or deploys code.
param([string]$Profile='default',[string]$Region='eu-west-2')
$ErrorActionPreference='Stop'
if($Region -cne 'eu-west-2'){throw 'Only eu-west-2 permitted.'}
$identity=& aws sts get-caller-identity --profile $Profile --region $Region --query Account --output text
if($LASTEXITCODE -ne 0 -or $identity -cne '145608514666'){throw 'AWS account mismatch.'}
$role='arn:aws:iam::145608514666:role/les-buttes-booking-private-staging-deploy'
$stack='arn:aws:cloudformation:eu-west-2:145608514666:stack/les-buttes-management-preview-isolated-staging/*'
$existing='arn:aws:cloudformation:eu-west-2:145608514666:stack/les-buttes-booking-staging/*'
$artifact='arn:aws:s3:::les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/booking-management-preview-isolated/sam/probe.zip'
$tests=@(
 @{Action='cloudformation:CreateStack';Resource=$stack},
 @{Action='cloudformation:CreateChangeSet';Resource=$stack},
 @{Action='cloudformation:DescribeChangeSet';Resource=$stack},
 @{Action='cloudformation:DescribeStacks';Resource=$existing},
 @{Action='s3:PutObject';Resource=$artifact},
 @{Action='s3:GetObject';Resource=$artifact}
)
$errors=@()
foreach($test in $tests){
 $decision=& aws iam simulate-principal-policy --policy-source-arn $role --action-names $test.Action --resource-arns $test.Resource --profile $Profile --region $Region --query 'EvaluationResults[0].EvalDecision' --output text
 if($LASTEXITCODE -ne 0 -or $decision -cne 'allowed'){
  $errors+="$($test.Action): $decision"
  Write-Host "MISSING: $($test.Action) on $($test.Resource) ($decision)"
 }else{
  Write-Host "Allowed: $($test.Action)"
 }
}
# IAM policy simulation does not reliably match the CloudFormation SAM-transform pseudo-account ARN.
# Verify the attached inline policy's exact SAM transform statement; the actual CreateChangeSet
# API remains the ultimate enforcement point. Never accept a wildcard or mismatched transform.
$policyJson=& aws iam get-role-policy --role-name 'les-buttes-booking-private-staging-deploy' --policy-name 'IsolatedManagementPreviewChangeSetOnly' --profile $Profile --region $Region --query PolicyDocument --output json
if($LASTEXITCODE -ne 0){throw 'Cannot inspect attached isolated preview IAM policy.'}
$policy=$policyJson|ConvertFrom-Json
$transform='arn:aws:cloudformation:eu-west-2:aws:transform/Serverless-2016-10-31'
$matched=@($policy.Statement|Where-Object {
 $_.Effect -ceq 'Allow' -and $_.Resource -ceq $transform -and
 @($_.Action) -ccontains 'cloudformation:CreateChangeSet'
})
if($matched.Count -ne 1){throw 'Required exact SAM transform permission missing from attached policy.'}
Write-Host 'Exact SAM transform statement verified in attached policy; actual AWS call will enforce authorisation.'
if($errors.Count -gt 0){throw "Deployment-review identity is missing $($errors.Count) required permissions. DO NOT PREPARE CHANGE SET."}
Write-Host 'IAM simulation passed; still verify SAM package, policy conditions and manual review.'
