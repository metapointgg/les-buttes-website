# Les Buttes management preview (LB-05)

This is a **separate, unbundled static prototype**, deliberately outside the public Astro `src/` and `public/` directories. It is not included in the production holiday cottages website.

## Local preview

From the repository root run `python -m http.server 5173 --directory management-preview` and open `http://127.0.0.1:5173`. The management staging API must have this exact origin allowed in its CORS configuration. Supply its eu-west-2 API Gateway URL and a Cognito **access** token. Tokens remain in JavaScript memory and are not persisted. The client reads booking inbox, detail and audit history; it exposes decline/cancel controls only when the token's owner group and booking status permit them. The backend remains authoritative for all permission and state checks.

**Security limitations:** Manual token entry is a development-only approach, not a production sign-in experience. Add Cognito hosted UI with PKCE, secure token lifecycle and CSP before release. This preview is not deployed or enabled automatically. The staging POST API is disabled by default, and approvals/payment confirmation remain unavailable.

## Tests

`node --test management-preview/model.test.mjs` and `node --check management-preview/app.mjs`. The booking management validation workflow runs these tests. Backend integration tests are in `services/booking-api`.

## Acceptance gaps

The responsive inbox/detail/audit view and guarded actions are implemented. Full browser end-to-end tests against an authenticated staging deployment, and Cognito PKCE sign-in, are still required before marking LB-05 complete.
