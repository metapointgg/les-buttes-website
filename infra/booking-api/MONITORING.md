# Airbnb change alerts — isolated staging monitor (NOT live reservations)

As of 24 October 2026, the 2027 holiday season has been reconciled against Airbnb in staging:
- Geranium: 14 nights of confirmed Airbnb reservations; 7 nights held for the direct booking.
- Honeysuckle: 21 confirmed Airbnb nights; 7 nights held for the same direct reservation.
- Both cottages accept arrivals from 20 March 2027.
- No unmatched in-season dates during the last **manual** export comparison.

## How it works

**Off by default.** When explicitly deployed, a separate scheduled Lambda checks both live private Airbnb calendar exports **every four hours**, from 2027-03-20 to 2027-10-02 checkout exclusive.

For each cottage it:
1. Loads the matching private calendar URL from **AWS SSM SecureString**, with only the parameter name in Lambda environment variables. Rejects unrecognised URL hosts, protocols or listing IDs.
2. Fetches a bounded 5MB calendar (15-second timeout; no redirects), parses all-day blocks, and discards event descriptions/guest details.
3. Reads the staging booking table (Query/BatchGet only), classifies Airbnb vs direct blocks, compares the occupied dates and reads its **own separate checkpoint DynamoDB table**.
4. Compares this feed with its previous successful snapshot. If dates were added/removed OR new unreviewed discrepancies appear, sends a **date-only SNS email**.
5. Updates only its checkpoint table to suppress repeated alerts for unchanged data. **Never imports, cancels, approves, releases or modifies a booking.** No production website changes.

The first scheduled run establishes the comparison baseline. If the initial calendars still agree with staging, **no alert is sent**. An initial inconsistency triggers a review alert. Malformed files, SSM errors and network failures are fail-closed; AWS SNS sends an operational warning and an AWS CloudWatch alarm also watches Lambda errors.

**Important:** Airbnb iCalendar can include owner-blocked dates, preparation restrictions and imported blocks. A missing or newly appearing date is not proof a guest booked or cancelled. Airbnb exports may lag actual changes; check the Airbnb host dashboard before confirming any direct reservation.

## 1. Store private feed links on your Windows machine (one time)

In PowerShell, from `C:\ProjectsGit\les-buttes-website`, first:

```powershell
git switch feature/direct-booking-requests-27-night
git pull --ff-only
npm run test:booking
```

Copy the **Geranium** Airbnb export URL to the clipboard (not both links together) and run:

```powershell
powershell -File infra/booking-api/save-airbnb-url-staging.ps1 -Unit geranium -Profile default
```

Then copy the **Honeysuckle** Airbnb export URL and run:

```powershell
powershell -File infra/booking-api/save-airbnb-url-staging.ps1 -Unit honeysuckle -Profile default
```

The helper checks the exact Airbnb listing ID, writes the URL via a short-lived temporary file to SSM SecureString, removes the temp file and clears the clipboard. It prints neither URL nor token; neither goes to Git. If a token ever leaks, regenerate the calendar export URL in Airbnb and save the replacement via the same command.

Parameter names (do **not** paste their values into reports):
- `/les-buttes/booking/staging/airbnb/geranium-url`
- `/les-buttes/booking/staging/airbnb/honeysuckle-url`

## 2. Deploy monitoring (needs SNS alert subscription email)

Deploy the existing **staging** stack with explicit opt-in:

```powershell
powershell -File infra/booking-api/deploy-staging.ps1 -Profile default -EnableCalendarMonitoring -MonitorAlertEmail "YOUR_EMAIL_ADDRESS"
```

Use your intended alert inbox in place of `YOUR_EMAIL_ADDRESS`. Confirm `DEPLOY-STAGING` when prompted. This performs an ordinary staging API update and the existing synthetic booking end-to-end rehearsal, plus creates:
- A small monitor-only DynamoDB checkpoint table
- A scheduled Node.js Lambda and EventBridge rule (every four hours)
- An SNS topic, SNS email subscription and CloudWatch Lambda error alarm

The current AWS account for this staging stack is **145608514666**, region `eu-west-2`. The operation creates **additional billable resources**. Existing confirmed Airbnb bookings and the reserved direct week must remain in the booking table. The deployment script cannot import, classify or remove them.

**You MUST click the confirmation link from AWS SNS in your email.** Alerts cannot be delivered to that inbox before confirmation. SNS may send a new confirmation request if you change the subscription endpoint. <https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html>

If you redeploy the staging API later while monitoring is active, pass `-EnableCalendarMonitoring -MonitorAlertEmail ...` again; without a monitor flag the script refuses to silently disable the existing monitor. To intentionally remove scheduled monitoring and its resources, pass `-DisableCalendarMonitoring` and understand that the separate checkpoint is then deleted. This is not a substitute for the manual Airbnb availability check required at booking approval.

## 3. Manually invoke an audit now

After CloudFormation finishes and you have confirmed the SNS subscription:

```powershell
$stack = (aws cloudformation describe-stacks --stack-name les-buttes-booking-staging --profile default --region eu-west-2 --output json | ConvertFrom-Json).Stacks[0]
$fn = ($stack.Outputs | Where-Object { $_.OutputKey -eq "CalendarMonitorFunctionName" }).OutputValue
aws lambda invoke --function-name $fn --payload '{}' --cli-binary-format raw-in-base64-out --profile default --region eu-west-2 "$HOME\Downloads\lesbuttes-calendar-check.json"
Get-Content "$HOME\Downloads\lesbuttes-calendar-check.json"
```

Expected if both previously reconciled calendars are unchanged: `{"ok":true,"results":[{"unit":"geranium","checked":true,"reviewRequired":false,...},{"unit":"honeysuckle","checked":true,"reviewRequired":false,...}]}`. No SNS alert is expected on an entirely clean first baseline.

If the Lambda returns `FunctionError`, check its CloudWatch logs in the AWS console and share the **sanitised** error text (never export URLs/SSM values). Test alert email separately if desired using an SNS Publish API test with date-free content; it should send only to an already confirmed subscription.

## 4. Operational response when an alert arrives

1. Look at the date ranges in the alert (Geranium vs Honeysuckle).
2. Open the Airbnb host dashboard to distinguish a confirmed reservation from a temporary/manual block.
3. Check the staging master with `node services/booking-api/admin.mjs list`, `show <id>`, and a fresh read-only `reconcile-airbnb.mjs` comparison after downloading the latest exports.
4. Only after confirming the actual booking, create or amend the master via the private host admin CLI. **Never automatically clear a master reservation because Airbnb no longer displays it**.
5. For the reserved direct booking for both cottages (28 Aug–4 Sep 2027), preserve its `direct/RESERVED` source and status until final payment/guest confirmation is independently established.

## Boundaries

- **Staging only**. IAM explicitly has read-only access to the booking table, with writes allowed only to monitor checkpoints. No guest names, guest email addresses, descriptions or calendar bearer URLs are sent in SNS messages.
- No automatic reconciliation/import, no real-time Airbnb booking webhook, and no guarantee the calendar export updates instantly.
- A disabled or missing SNS subscription means no email notifications; Lambda CloudWatch logs/alarms still require periodic verification.
- An Airbnb export URL could be rotated/revoked; monitor reports the failure and the private SSM parameter must be refreshed.
- Automatic calendar date matching does not replace full guest payment, cancellation, minimum-stay or commercial acceptance checks.
