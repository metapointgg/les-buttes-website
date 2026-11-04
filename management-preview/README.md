# Les Buttes management preview (LB-05)

This is a **separate, unbundled static prototype**, deliberately outside the public Astro `src/` and `public/` directories. It is not included in the production holiday cottages website.

## Local preview

From the repository root run `python -m http.server 5173 --directory management-preview` and open `http://127.0.0.1:5173`. The management staging API must have this exact origin allowed in its CORS configuration. Supply its eu-west-2 API Gateway URL and a Cognito **access** token. Tokens remain in JavaScript memory and are not persisted. The client reads booking inbox, detail and audit history; it exposes decline/cancel controls only when the token's owner group and booking status permit them. The backend remains authoritative for all permission and state checks.

**Security limitations:** Manual token entry is a development-only approach, not a production sign-in experience. Add Cognito hosted UI with PKCE, secure token lifecycle and CSP before release. This preview is not deployed or enabled automatically. The staging POST API is disabled by default, and approvals/payment confirmation remain unavailable.

## Tests

`node --test management-preview/model.test.mjs` and `node --check management-preview/app.mjs`. The booking management validation workflow runs these tests. Backend integration tests are in `services/booking-api`.

## Acceptance gaps

The responsive inbox/detail/audit view and guarded actions are implemented. Full browser end-to-end tests against an authenticated staging deployment, and Cognito PKCE sign-in, are still required before marking LB-05 complete.

## Hosted staging read-only preview — 4 November 2026

**Staging URL:** https://d123fnjf47zmyp.cloudfront.net/management/index.html

This is published under the existing *staging* CloudFront distribution `E3A3ONLRMX3AKJ` and S3 bucket `les-buttes-booking-preview-staging-145608514666` (objects under `management/`). It is **not** on `lesbuttes.com` or the existing live operations site.

Click **Sign in with Cognito**. This uses the *new, separate* public user-pool client `les-buttes-management-readonly-staging` (`1a0i42vp4gi24i5orh8i4jjhmr`) with authorisation code + PKCE S256, exact HTTPS redirect to this page, and no client secret. Existing staging `management` group accounts require membership in `lesbuttes-viewer`; three existing CONFIRMED and enabled management accounts were added, while one account still at FORCE_CHANGE_PASSWORD was not changed. No `lesbuttes-owner` or `lesbuttes-admin` privileges were granted.

The read-only API `https://g2vazft1vb.execute-api.eu-west-2.amazonaws.com` now allows **only** the new client and the exact staging CloudFront CORS origin, via isolated stack update `lb05-management-pkce-readonly-20261104` (CloudFormation `UPDATE_COMPLETE`). The DynamoDB permissions remain GetItem/Query on the one existing staging table/GSI; write, approval and checkout switches are false. Hosted UI hides manual-token entry and all owner controls. The browser validates the client, issuer, token-use, viewer role, short-lived expiry and PKCE state for its user interface, while **API Gateway** remains responsible for cryptographically verifying the JWT. Tokens are held in JavaScript memory only, not localStorage or sessionStorage. Temporary PKCE state and verifier are stored in sessionStorage until consumed, and the callback clears the query from browser history.

Verified technical evidence: five files deployed in S3; CloudFront invalidation `I85QSQ8NSSE0EQAAOVK52LKYX7` `Completed`; CloudFront pretty-URL function leaves `/management/index.html` intact. Backend direct Lambda probe using **synthetic test claims**, new Cognito client and `lesbuttes-viewer` returned `200` with **six** staging bookings. Synthetic viewer POST and old-client claims returned `403`. These tests do **not** prove end-to-end OAuth or that an actual browser can fetch the data.

**Final LB-05 acceptance:** an authorised account must visit the hosted URL, complete Cognito sign-in, see booking inbox, detail and audit, and verify that owner actions remain unavailable. Record a browser result with no access token, password, email address or guest information copied into the tracker. Do not mark LB-04/LB-05 complete until these tests pass. The local manual-token preview remains a development-only alternative.
