# Store one private Airbnb calendar export URL as a staging SSM SecureString.
# URL is read only from clipboard, not command-line args or git.
# Usage: Copy Airbnb Geranium export URL, then:
#   powershell -File infra/booking-api/save-airbnb-url-staging.ps1 -Unit geranium -Profile default
param(
    [Parameter(Mandatory=$true)][ValidateSet('geranium','honeysuckle')][string]$Unit,
    [string]$Profile = 'default',
    [string]$Region = 'eu-west-2'
)
$ErrorActionPreference='Stop'
if($Region -ne 'eu-west-2'){throw 'Calendar feed secrets are restricted to eu-west-2 staging.'}
if(-not (Get-Command aws -ErrorAction SilentlyContinue)){throw 'AWS CLI is required.'}
$identity=& aws sts get-caller-identity --profile $Profile --region $Region --output json | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or $identity.Account -ne '145608514666'){throw 'AWS account must be the verified Les Buttes staging account 145608514666.'}
$url=(Get-Clipboard -Raw).Trim()
$listing=if($Unit -eq 'geranium'){'17564897'}else{'15695088'}
$pattern='\Ahttps://www\.airbnb\.com/calendar/ical/'+$listing+'\.ics\?t=[a-zA-Z0-9]{20,128}\z'
if($url -cnotmatch $pattern){throw 'Clipboard is not the correct cottage Airbnb export URL. Copy the calendar export link and retry.'}
$paramName="/les-buttes/booking/staging/airbnb/$Unit-url"
$body=@{Name=$paramName;Type='SecureString';Value=$url;Overwrite=$true;Description="Private $Unit Airbnb iCalendar export token (staging read-only watcher)"}
$temp=Join-Path ([System.IO.Path]::GetTempPath()) ("lb-monitor-"+[Guid]::NewGuid().ToString('N')+".json")
try{
    [System.IO.File]::WriteAllText($temp,(ConvertTo-Json -InputObject $body -Depth 5),(New-Object System.Text.UTF8Encoding $false))
    & aws ssm put-parameter --cli-input-json "file://$temp" --profile $Profile --region $Region --output none
    if($LASTEXITCODE -ne 0){throw 'The SSM SecureString write failed.'}
    Write-Host "Saved $Unit Airbnb calendar token in encrypted staging SSM Parameter Store. No URL printed or committed."
    Set-Clipboard -Value ''
    Write-Host 'Clipboard cleared to reduce accidental sharing.'
}finally{
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
