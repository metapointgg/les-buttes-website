# Guest journey → staging booking master (synthetic-only)

This work is **code only** on feature/restore-booking-journey-20261026, not deployed.

- Existing read-only /availability, /published-pricing and /quote continue unchanged.
- The four-step guest journey displays an enabled submit control **only on localhost/127.0.0.1** and only when both `PUBLIC_BOOKING_STAGING_SUBMIT_URL` and `PUBLIC_BOOKING_STAGING_TURNSTILE_SITE_KEY` are set.
- A separate HTTP API POST /request receives an explicit Turnstile response; the server verifies token at Cloudflare including `hostname=localhost` and `action=lesbuttes-staging-booking`. The secret is held in **SSM SecureString**, read at runtime, never sent to the browser.
- The server uses the already tested published pricing and master occupancy readers, enforces weekly Saturday stays, and atomically writes synthetic metadata plus UNIT DATE holds. Concurrent bookings for an occupied night fail transactionally.
- **Entered names, emails, telephone numbers and notes are never stored**. The saved booking always uses Synthetic Staging Guest and test@example.invalid. No emails, payments or confirmation.
- Deployment uses isolated `infra/booking-staging-guest/template.yaml`. `EnableSyntheticWrites=false` by default and IAM write permissions are conditional.
- Do not alter the public read-only stack or enable real guest submissions.

## Validation

Run `npm test`, `node --test services/booking-api/test/staging-guest-request.test.mjs`, `sam validate --template-file infra/booking-staging-guest/template.yaml --lint`, and `sam build --template-file infra/booking-staging-guest/template.yaml`. Set `AWS_PROFILE=default`, region eu-west-2 for any future deployment.

## Release gates (not completed)

1. Configure Cloudflare Turnstile for localhost and create an SSM SecureString named like `/les-buttes/staging/turnstile/secret`. Do **not** put this in a Git file or SAM parameter value.
2. The staging request quota is now implemented as two DynamoDB counter updates **within the same atomic transaction as the booking hold**: 3 accepted holds per source and 20 total per UTC hour. Source identifiers are HMAC-hashed; invalid source information fails closed. Origin/CORS is not authentication. Validate quota tests and deployment permissions before enabling writes.
3. Review CloudFormation stack changes, separate IAM, cost and throttling; then deploy the guest endpoint in a new staging stack. No existing production changes.
4. Set localhost-only `PUBLIC_BOOKING_STAGING_SUBMIT_URL` and `PUBLIC_BOOKING_STAGING_TURNSTILE_SITE_KEY` in local .env.local, restart Astro.
5. Test request, management listing, approval/decline, conflicts, quota, CAPTCHA failures, expiry, and absence of submitted contact information in DynamoDB/CloudWatch.
6. Real customer workflow requires separate security, retention, consent/terms, guest notifications, and confirmed payment plan. Never turn this synthetic Lambda into production without redesigning its identity and data lifecycle.

No public deployment should occur while any gate is incomplete.
