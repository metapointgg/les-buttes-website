# CMS booking terms release boundary (not yet enabled)

Pages CMS has a `booking-terms` file editor at `src/data/booking-terms.json`.
Initial status is DRAFT and all policy text fields are intentionally blank. No guest policy has been invented.
The validator `derivePublishedBookingTerms` refuses drafts and incomplete English booking/cancellation text. It binds version and both texts into a SHA-256 digest.

## Important separation
- Pages CMS commits content to Git. The deployed private AWS Lambda has **no** reader for that Git file and must continue to fail closed.
- Even switching a CMS file to PUBLISHED does **not** enable bookings: a separate reviewed build/release step must validate the content, transmit a versioned immutable snapshot to a trusted server-side store, then configure the private reader to fetch that snapshot. Do not read untrusted browser-submitted legal text.
- A public website terms display should use the same approved version. Translation handling and legal review remain pending.
- Turnstile secret must be stored in SSM SecureString or Secrets Manager and retrieved only inside the private service. No secret in Git, Pages CMS, public JS or Lambda environment plaintext.
- No API Gateway route, DynamoDB writes, SES or SumUp integration was created in this change.
