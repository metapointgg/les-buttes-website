# Synthetic provisional booking hold — staging rehearsal only

This stage adds an internal **CLI-only** flow, not a public website request endpoint. It writes to the *existing staging booking table* only if explicitly opted in, with a synthetic guest identity and published pricing fetched from the same table. It must not be used with real guest details.

## Dry run (read-only)

```powershell
cd C:\ProjectsGit\les-buttes-website
$env:AWS_PROFILE="default"
$env:AWS_REGION="eu-west-2"
$env:BOOKING_ENVIRONMENT="staging"
$env:BOOKINGS_TABLE="les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK"
node services/booking-api/preview-synthetic-hold.mjs both 2027-07-10 2027-07-17 6 1
```

Dry run performs only reads, validates availability and published rates, and prints the predicted **24-hour** hold (14 nightly slots for both cottages) without guest information beyond the synthetic test address.

## Optional *explicit* staging write

Do not run this until you are ready to create a genuine temporary block on the *staging* calendar. It may affect staging availability and be visible in the management PWA.

```powershell
$env:CONFIRM_SYNTHETIC_HOLD="I_ACCEPT_STAGING_TABLE_WRITES"
node services/booking-api/preview-synthetic-hold.mjs both 2027-07-10 2027-07-17 6 1 --execute
Remove-Item Env:CONFIRM_SYNTHETIC_HOLD
```

The DynamoDB transaction creates one BOOKING#.../META record and conditional UNIT#.../DATE#... items. Competing holds for the same night cannot both succeed. The request is synthetic with test@example.invalid, REQUESTED/PENDING_REVIEW, no email, SumUp payment or real confirmation. Date slots are automatically reusable after the 24-hour hold expiry; the metadata remains for audit (90-day TTL). Check the request in the staging management PWA and use its existing cancellation pathway if needed. **Do not manually delete occupied slots unless their ownership and lifecycle have been reviewed.**

## Important boundaries

This is not yet a production-grade web POST route. The public staging /availability, /published-pricing and /quote Lambda retains DynamoDB read-only IAM. Do not add a staging token to browser code. An unauthenticated POST route requires separate anti-bot/rate-limiting and abuse testing before real users may submit; an authenticated synthetic-only test route must also be reviewed independently. Nothing here deploys or changes an AWS stack automatically.
