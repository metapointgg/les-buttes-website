# AWS staging rehearsal — not production

The booking backend is **not deployed automatically** by website GitHub Actions. PR #41 remains draft. Use this runbook only for an *isolated* AWS test stack, with synthetic guests, rates and season rules. This script does not modify the site's main branch or production booking links.

## 1. Local prerequisites

In PowerShell, from the repository root:

- AWS CLI v2 configured with an AWS profile that can create CloudFormation, DynamoDB, Lambda, HTTP API Gateway, IAM and SSM resources.
- AWS SAM CLI and Node.js 22 or newer.
- Region eu-west-2.
- No SumUp credentials and no actual customer records are required.
- AWS deployment creates billable resources (including DynamoDB backups). Review your billing alarms and available AWS credits.

The deployment will display the account ID and require you to type DEPLOY-STAGING before creating or modifying resources.

## 2. Deploy and run the staging test

Run:

    powershell -File infra/booking-api/deploy-staging.ps1 -Profile YOUR_AWS_PROFILE

The script will:

1. Check AWS identity and refuse a stack without staging in its name.
2. Write synthetic open dates and nightly prices to dedicated SSM String parameters (no approved customer price data required).
3. Build the SAM app and deploy the les-buttes-booking-staging CloudFormation stack.
4. Generate fresh random calendar and staging access tokens.
5. Use Cloudflare Turnstile's published testing credentials, never a production key.
6. Set the test API's mode to staging and require an access token on every request.
7. Create a synthetic request for test@example.invalid without sending any email or real payment link.
8. Verify booking availability, an overlapping-request conflict, a combined-cottage conflict that must not hold the other cottage, and a rejected 28-night booking.
9. Approve the synthetic request with a test.invalid URL, confirm with a TEST- reference, then cancel and verify availability returns.

The API cannot accept a non-synthetic guest email in staging. The approval CLI cannot accept a real SumUp pay.sumup.com link in staging, and cannot accept a TEST- payment reference outside staging.

After successful tests, the staging stack remains deployed (and may continue accruing minimal AWS charges). It does not alter the real website. To remove it when finished, use SAM/CloudFormation stack deletion after reviewing whether any test records need preserving, and separately delete the two staging SSM parameters.

### Troubleshooting

If a rehearsal fails, the script reports the synthetic booking ID if known. Use the private host CLI on the staging table to inspect and manually release the test block. A failed payment simulation must never be confused with a real SumUp payment.

The automatically generated staging access token is session-only; rerunning deployment rotates it. Do not commit a staging token, Airbnb iCalendar secret URL or merchant credentials to GitHub, Pages CMS or public website files.

The PowerShell script has not been executed in your AWS account by ChatGPT because AWS account access is not connected in this conversation. CI validates pure booking logic but does not prove IAM/CloudFormation deployment or real DynamoDB transaction behaviour; those require the staged run.

## 3. Reviewing real Airbnb calendar data — read-only

In Airbnb for each cottage:

Calendar → Availability → Connect calendars → Export calendar.

Airbnb provides a private .ics calendar link. Download its content securely to your own computer (do not paste the URL into GitHub or this repository). Then, from services/booking-api/:

    node preview-airbnb.mjs geranium "C:\Private\geranium.ics"
    node preview-airbnb.mjs honeysuckle "C:\Private\honeysuckle.ics"

The preview reports blocked date ranges and prints suggested private admin.mjs block commands. It never writes to DynamoDB. The parser deliberately rejects unfamiliar datetime/recurrence formats rather than inventing dates. It discards guest names, descriptions and email text.

**Critical:** Airbnb's exported calendar includes blocked dates for availability settings, preparation time, pending requests and confirmed bookings. A blocked date cannot be assumed to be a confirmed reservation. Compare each preview range to Airbnb's host reservation records before recording it in the master calendar.

After reviewing blocks, manually record each verified range using the staging-table CLI. Never automate an unreviewed import. Calendar sync is delayed, so continue checking Airbnb's host calendar before approving direct bookings.

## 4. Later production readiness

Staging must succeed before we consider a real booking launch. Production still needs approved 2027 rate/season boundaries, a full calendar reconciliation, the exact Strict cancellation and refund wording, SumUp merchant checks, email setup, and production monitoring. Keep the GitHub PR in draft until those gates are satisfied.
