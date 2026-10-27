# Private integration testing — current permitted boundary

Current Lambda `les-buttes-real-guest-staging` intentionally always returns 403.
Do not attach a public trigger, grant DynamoDB writes, deploy the transaction planner as a Lambda entrypoint, or store real guest information.

## Safe first AWS integration: KMS encrypt a synthetic marker, no database writes
From the repository root (PowerShell):

```powershell
$ErrorActionPreference = 'Stop'
$Region = 'eu-west-2'
$Profile = 'default'
$Account = (aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $Account -ne '145608514666') { throw 'Wrong account' }
$KeyArn = (aws cloudformation describe-stacks --stack-name les-buttes-booking-real-staging --profile $Profile --region $Region --query "Stacks[0].Outputs[?OutputKey=='KeyArn'].OutputValue | [0]" --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $KeyArn -notmatch '^arn:aws:kms:eu-west-2:145608514666:key/') { throw 'Unexpected key' }
$Marker = Join-Path (Get-Location).Path 'synthetic-kms-input.tmp'
$Cipher = Join-Path (Get-Location).Path 'synthetic-kms-cipher.json'
try {
 [System.IO.File]::WriteAllText($Marker,'SYNTHETIC-TEST-ONLY;NO-GUEST-DATA')
 aws kms encrypt --key-id $KeyArn --plaintext "fileb://$Marker" --encryption-context application=les-buttes-booking,environment=staging,bookingId=synthetic-kms-probe --region $Region --profile $Profile --output json > $Cipher
 if ($LASTEXITCODE -ne 0) { throw 'KMS encryption failed' }
 $Result = Get-Content $Cipher -Raw | ConvertFrom-Json
 if (-not $Result.CiphertextBlob -or $Result.KeyId -ne $KeyArn) { throw 'Unexpected encryption result' }
 Write-Host 'Staging KMS encrypt succeeded: ciphertext returned, no guest information stored.'
} finally {
 Remove-Item -LiteralPath $Marker,$Cipher -Force -ErrorAction SilentlyContinue
}
```

This probes AWS KMS using the current CLI principal, **not the Lambda role**. A role-level encrypt test requires a separately reviewed private Lambda handler change. AWS may record KMS audit metadata in CloudTrail; never place guest information in the encryption context.

## Next controlled test design (NOT IMPLEMENTED)
1. Isolated test table (not the shared staging booking master), dedicated KMS test identity, seeded dummy pricing.
2. Restricted private test worker with only table-scoped conditional writes, dedicated fixture-only credentials, a non-public invocation surface and zero real PII.
3. Verify one atomic commit; read back metadata and encrypted record; attempt repeat and overlapping slot transaction, both must fail without partial writes.
4. Verify cleanup of exactly the test-owned keys, including TTL and idempotency record. Do not delete unrelated bookings.
5. Only consider shared staging table tests after test isolation and cleanup are independently validated.

IMPORTANT: the current planner creates metadata with `synthetic:false` to represent the eventual real flow. It must NEVER be executed against the shared staging table as an integration test. Doing so could appear as a real booking to management and prevent safe synthetic cleanup.
