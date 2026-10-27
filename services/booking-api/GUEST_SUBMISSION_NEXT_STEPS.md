# Real guest submission: next integration boundary

Current private Lambda remains blocked and no external submission path is attached.

The pure `guest-submission-preflight.mjs` checks body shape, trusted terms, trusted price/availability, idempotency request-key format and a *server-verified* Turnstile outcome. Its `turnstileVerified` input must only be supplied by the service after checking Turnstile's token with Cloudflare; never derive it from guest JSON.

## Security and functional integration still required
1. Obtain current terms/version/digest from published CMS data. No policy content is invented or deployed in this phase.
2. Read availability and pricing from authoritative server-side providers; establish freshness/version requirements. Re-quote on the server and do not rely on client cached results.
3. Enforce per-origin/CSRF protections as applicable, security headers, request size limits, rate controls and anti-automation token verification (including hostname/action expectations and single-use tokens).
4. Persist an idempotency record that binds the request key to its payload fingerprint. The current DynamoDB transaction planner stores only a hashed key; the fingerprint check/replay behaviour is not yet implemented. A same-key/different-payload request must conflict, while valid replays must resolve to the existing booking.
5. Resolve the booking metadata/contact retention lifecycle before accepting real guests. A 90-day TTL must not delete confirmed booking records while they are operationally required; personal data should follow an explicit retention policy.
6. Ensure conditional holds are released or extended correctly on approval, payment and rejection; avoid relying solely on eventual TTL deletion to reclaim dates.
7. Introduce a new separately controlled submission Lambda with its own least-privilege role; do not repurpose the existing private integration-test Lambda for public internet requests.
8. Encrypt guest PII using KMS before the atomic master-table transaction; add secure decrypt/read capability solely to an authenticated management role.
9. Implement transactional/after-commit email delivery, observable failures and reconciliation before activating.
10. Treat a success as a **booking request pending approval**, not payment or confirmation. No SumUp call is part of this preflight.

## Deployment status
- Code + tests only; no AWS updates required or performed.
- `BOOKING_REAL_GUEST_WRITES=false` and `BOOKING_PRIVATE_INTEGRATION_TESTS_ENABLED=false`.
- Do not route the website to `guest-submission-preflight.mjs` directly; it is a pure module, not a runnable HTTP handler.
