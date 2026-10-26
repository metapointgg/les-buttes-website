# Isolated read-only public staging API

This new stack is **separate** from the existing les-buttes-booking-staging stack and uses its existing table by reference. Do not run the older broad deploy-staging.ps1 script or modify the live booking stack. It exposes only date occupancy and **published** rate bands; no guest details, booking creation, payment, staging token or administrative API.

## Review/build (no AWS changes)
```powershell
cd C:\ProjectsGit\les-buttes-website
npm test
sam validate --template-file infra/booking-public-read/template.yaml --lint
sam build --template-file infra/booking-public-read/template.yaml --build-dir .aws-sam/public-read
```

## Deploy separate staging stack

Review identity and the existing table, then use a NEW CloudFormation stack name:
```powershell
aws sts get-caller-identity --profile default
aws dynamodb describe-table --table-name les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK --region eu-west-2 --profile default --query "Table.TableArn"

sam deploy --template-file .aws-sam/public-read/template.yaml `
  --stack-name les-buttes-booking-public-read-staging `
  --region eu-west-2 --profile default --capabilities CAPABILITY_IAM `
  --resolve-s3 `
  --parameter-overrides ExistingStagingTable=les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK PreviewOrigin=http://localhost:4321 `
  --no-confirm-changeset
```
**Important:** Review CloudFormation resources and IAM before running the deploy command. The only new resources should be a dedicated read-only Lambda, HTTP API, log group/roles and permissions. The existing table remains a reference, not a managed resource of this stack. Do not use this template to change the original booking stack.

Get the API base URL:
```powershell
aws cloudformation describe-stacks --stack-name les-buttes-booking-public-read-staging --region eu-west-2 --profile default --query "Stacks[0].Outputs"
```

## Test browser from local machine

Create a temporary `.env.local` in the website repository:
```text
PUBLIC_BOOKING_STAGING_READ_URL=https://YOUR-API-ID.execute-api.eu-west-2.amazonaws.com
```
Replace the URL with the actual CloudFormation output. Restart `npm run dev`. The existing booking preview will use the remote staging API only when served from **localhost / 127.0.0.1**, rather than using the local 4328 bridge.

With a correctly matched `Origin: http://localhost:4321`, verify both `/availability` and `/published-pricing`. Confirm blocked dates and Geranium/Honeysuckle published price versions, plus the four-step browser experience. Leave booking submissions disabled.

## Security and limitations

This is a **public unauthenticated** read-only staging API. CORS and origin checks limit browser access, not server-side requests; they must not be treated as authentication or as protection for sensitive data. Responses are intentionally limited to non-personal blocked date ranges and published prices. The stack has no DynamoDB write permissions. Reserved concurrency limits simultaneous Lambda execution but is not a full request-rate cap. For production, add appropriate throttling/WAF controls and move to a separately reviewed production design. Never embed private calendar URLs or credentials in the website build. Do not merge the recovery branch into the public website until a release review.
