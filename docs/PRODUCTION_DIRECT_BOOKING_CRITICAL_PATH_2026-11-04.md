# Direct booking production release — authoritative architecture and blockers

**Audit:** 4 November 2026. **Release status:** blocked; no production booking deployment authorised.

## Canonical management app — do not build another one

The owner-facing application is **https://lesbuttes.ozanne-family.com/**, backed by CloudFormation stack `les-buttes-cottage-management`, API Gateway `i2irz87c82`. It manages pricing, booking rules and owner operations. Do not replace it with `d123fnjf47zmyp.cloudfront.net/management/`, which is only an isolated read-only acceptance preview and is not the production management platform.

**Verified AWS configuration on 4 Nov:** the canonical management Lambda has `BOOKING_MASTER_TABLE=les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK` and `BOOKING_MASTER_ENVIRONMENT=staging`. Actions, drafts, pricing approval/publication/rollback are enabled there but operate against the **staging booking master**, not a production booking master. This distinction must be resolved before going live.

## One source of truth

The management app publishes immutable, versioned `CONFIG#pricing#<cottage>` records and points `CURRENT` to an approved version. All price calculations — public quote, guest request creation, owner review and checkout amounts — must use the relevant published values from the booking master and preserve the pricing version(s) in the booking snapshot. Never quote live guests from a Lambda `BOOKING_RATES_JSON` variable or independently from illustrative UI prices. A missing, unpublished or ambiguous rate **must fail closed** rather than substitute a fallback.

### Identified divergence
- **Legacy staging booking Lambda:** `les-buttes-booking-staging-BookingFunction-tzvgfNDVJF22`, environment `BOOKING_RATES_JSON` uses a flat 2027 season with Geranium £100/night and Honeysuckle £120/night.
- **Published configuration in staging DynamoDB:** Geranium version 3 and Honeysuckle version 1 have variable seasonal rates (e.g. 26 June–28 August 2027: Geranium £155/night and Honeysuckle £140/night).
- **Source correction committed on this branch only (not deployed):**
  - `services/booking-api/published-pricing.mjs`: consistently reads published current records from the shared DB; computes exact pence; enforces minimum stay; fails closed; includes cottage pricing versions.
  - `services/booking-api/index.mjs`: GET `/availability` and POST `/requests` call the **same published-pricing function**.
  - `services/booking-api/test/published-pricing.test.mjs`: regression tests for 2027 published amounts, missing/duplicate bands, exclusive end dates, and protection against environment fallback.
  - Pure logic smoke test passed for the 2027 week 26 June–3 July: Geranium £1,085 + Honeysuckle £980 = **£2,065**.
- **Important:** older deployed Lambda still uses environment rates until the corrected code is packaged, staged, tested and deployed. Other preview and public-read paths also require integration audit; this source change does not by itself prove every current API is unified.

## No more staging UI feature expansion

The existing website release pipeline deploys `main` to `lesbuttes.com`. Its production bucket has no `/book/` page and the main branch does not contain `src/pages/book/index.astro`. The booking page on this feature branch is gated by `PUBLIC_BOOKING_REQUESTS_ENABLED` and expects API URL and Turnstile configuration; its preview and live journeys currently differ. Bring the approved four-step journey into the live flow rather than replace it with a basic form.

## Production critical path — must close in order

1. **API consolidation:** identify every public quote and guest submission endpoint; route to the same database-backed published price/rule source; remove or deprecate environment and preview prices from any path presented as an authoritative guest quote. Ensure submitted requests independently reprice on the server, persist immutable versioned quotes and reserve dates atomically.
2. **Stage the corrected code:** build/test and deploy to the existing staging booking API through infrastructure-as-code; check quoted totals against the management app across season boundaries, for single/both cottages and missing configs; verify no unauthorised guest PII exposure.
3. **Use the existing management app end to end:** validate receiving new requests, approving/rejecting, locking dates, issuing SumUp payment links *only after approval*, verifying payment before confirmation, audit and reversal. Avoid building a new management UI.
4. **Production infrastructure and configuration:** create or explicitly designate the production booking table/service(s), production pricing and stay-rule publications, genuine Turnstile keys, least-privilege IAM, logging, monitoring and idempotency. The management app must deliberately point at the correct production master when released, with staging and production isolated.
5. **Email delivery:** SES production sending access is granted but `lesbuttes.com` identity is **not verified** and its DKIM status is `FAILED` (4 Nov audit); fix DNS with the actual DNS provider or use a verified approved sender until corrected. No DNS changes without approval.
6. **Website release:** merge/release the complete four-stage guest journey to `main` only after production API and security acceptance. Deploy behind a disabled feature flag, smoke-test, then enable in a controlled manner.
7. **Go/no-go:** verify Airbnb synchronisation and conflict prevention, customer-facing email, owner response, deposit/full-payment decision, refund handling, rollback, monitoring and recovery. Obtain explicit owner production approval.

A production release is not considered complete merely because staging has successful synthetic tests or the management dashboard displays published values.

## Current release decision
**NO GO**. Do not enable live requests or payments until the above blockers are closed and acceptance results are recorded. No production booking/data/configuration changes were made by the 4 November corrective source commits.

## Integration verification update — 4 November 2026, 18:40 GMT

**Code/CI**
- `GET /availability` and `POST /requests` on the guest booking handler now call `quoteFromPublishedMaster` (feature branch only; not deployed).
- `quoteFromPublishedMaster` was consolidated to reuse `quotePublishedBands`, the established published-pricing algorithm used by `staging-quote-handler.mjs`. Both paths read the same DynamoDB `CONFIG#pricing#<cottage>/CURRENT` values, with consistent reads and version snapshots.
- Published master smoke values (26 June–3 July 2027, both cottages) remain **£1,085 + £980 = £2,065**.
- Dedicated GitHub Actions `Booking published-pricing release gate` passed, including the full booking API test suite. The root PR test initially failed because it did not install nested booking API SDK dependencies; root `test:booking` has now been amended to install those pinned service dependencies before tests. Verify the refreshed PR checks before merging.

**Deployed infrastructure findings**
- Existing public-read staging Lambda returned HTTP **200** for `/availability` and `/published-pricing`, but **503** for `/quote` across valid 2027 dates (synthetic Lambda request events). This must be fixed and reverified before any public direct-quote journey is enabled.
- Existing public-read Lambda IAM already includes DynamoDB GetItem and Query on the shared staging master; the 503 points at route implementation/package/configuration rather than an obvious missing table-read policy. No deployed Lambda was changed.
- The repository already has an **isolated source-controlled staging quote service**: `infra/booking-staging-quote/template.yaml`, `services/booking-api/staging-quote-handler.mjs` and `.github/workflows/staging-quote-changeset.yml` (manual staging-only workflow). Reuse this rather than adding another preview UI.
- Preflight IAM simulation for role `les-buttes-booking-private-staging-deploy`: `cloudformation:CreateChangeSet=allowed`, scoped artifact `s3:PutObject=allowed`, but `cloudformation:ExecuteChangeSet=implicitDeny`. This is intentional separation of build/approval; a separately authorised principal must execute a reviewed change set.
- Attempted ad-hoc package creation failed runtime ZIP validation; AWS blocked an alternate inline code deployment. **No staging Lambda code was deployed.** The unused change set and invalid ZIP artifact were deleted. Use the repository's SAM/GitHub Actions build and manual deployment route instead of bypassing the controls.

**Next owner-visible production gate**
1. Get the standard PR validation suite green (CI verification).
2. Invoke the existing **Deploy isolated staging quote API (manual only)** GitHub Action on branch `feature/direct-booking-requests-27-night` with its documented confirmation text `STAGING-QUOTE-ONLY`. It packages the quote Lambda and creates a change set without executing it. Review the change set before separately authorised execution.
3. Verify `GET /quote` against published Geranium/Honeysuckle records and availability, then integrate the request path with the canonical management app. Only then address the production table, SES sender identity, genuine Turnstile, SumUp settlement and go-live acceptance.

## Staging quote CI deployment gate — 4 November 2026, 20:16 GMT

- Workflow `.github/workflows/staging-quote-changeset.yml` now separates environment approval from the branch-specific OIDC deployment job (commit `33816bee`).
- Added explicit `cloudformation:CreateChangeSet` SAM transform IAM prerequisite to the existing deploy-role preflight (commit `ca3498d1`). The preflight produces a direct diagnostic if the scoped permission is absent.
- Direct role simulation confirms the SAM transform permission is **still implicitDeny**. Existing staging stack change-set and artefact creation privileges are **allowed**; execution stays deliberately denied.
- No new manual workflow run has occurred since the original failed run `41897966042`. The isolated quote CloudFormation stack and change set remain absent.
- AWS IAM policy mutation was blocked by connector safety controls, so the missing scoped permission requires an authorised administrator. See [IAM prerequisite](../infra/booking-staging-quote/IAM-PREREQUISITE.md).
- **Next release-critical action:** grant the exact transform-scoped permission, verify the simulator now reports `allowed`, manually dispatch the guarded workflow on `feature/direct-booking-requests-27-night` using `STAGING-QUOTE-ONLY`, then review generated change-set resource actions. Do not execute or enable live bookings without separate approval.

## 4 November 2026 — isolated staging quote deployed and live-tested

- GitHub Actions run [41909620636](https://github.com/metapointgg/les-buttes-website/actions/runs/41909620636) passed all checks and created change set `samcli-deploy1793825194`.
- Owner explicitly approved execution; CloudFormation stack `les-buttes-isolated-quote-staging` in `145608514666/eu-west-2` reached `CREATE_COMPLETE`, all five resources `CREATE_COMPLETE`.
- Staging quote endpoint: `https://yo8p94y63b.execute-api.eu-west-2.amazonaws.com/quote` (preview origin only).
- Live Lambda invocation using the staging origin and authoritative staging DynamoDB pricing for 3–10 July 2027, 8 guests, both cottages returned HTTP 200: Geranium £1,085, Honeysuckle £980, total £2,065, `bookingConfirmed:false`.
- Further live Lambda tests: valid single cottage HTTP 200; wrong origin HTTP 403; non-Saturday arrival HTTP 422; excessive guest count HTTP 422; over-27-night stay HTTP 422.
- Outstanding: validate an occupied-date conflict against known staging slots; connect quote endpoint into staging website flow; prove request → owner approval → sandbox SumUp payment → confirmation/cancellation and availability release. Production infrastructure and release gates remain separate and unapproved.
- These checks used direct Lambda invocation, **not** an external HTTP API Gateway request; external endpoint/CORS and frontend integration still need separate verification.

## 4 November 2026 — post-deployment CI and private availability

- Commit `cc6e4c1e1bcebed1cf0390710aefc6a3a1f5b9d9` triggered three staging workflows; all completed successfully.
- Management validation [41910684950](https://github.com/metapointgg/les-buttes-website/actions/runs/41910684950) initially failed npm install with transient `ETARGET @aws-sdk/nested-clients@^3.998.0`; rerun of failed jobs passed unchanged, including backend tests, management model tests, hosted management HTTP smoke and SAM validation.
- Feature CI [41910684626](https://github.com/metapointgg/les-buttes-website/actions/runs/41910684626) passed Astro build, booking API/discovery tests, multilingual pages, safety gates, availability and quote SAM builds. Its private staging availability deployment succeeded and checked anonymous access returned HTTP 401.
- Isolated preview website deployment [41910684507](https://github.com/metapointgg/les-buttes-website/actions/runs/41910684507) passed.
- CloudFormation verified: `les-buttes-private-availability-staging` `UPDATE_COMPLETE`, endpoint `https://b28jlpm3a0.execute-api.eu-west-2.amazonaws.com/api/staging/availability`; `les-buttes-isolated-quote-staging` `CREATE_COMPLETE`.
- Remaining: test public staging quote endpoint through API Gateway with allowed origin, known occupied-date conflict, frontend quote integration, authenticated management actions, and end-to-end payment/confirmation; no production release approval.

## 4 November 2026 — occupied-date conflict acceptance

- All three workflows for commit `6cbdd16cd695777cf13d1d38f8384c8bce0cc634` succeeded: feature CI `41912264242`, preview website `41912264232`, management validation `41912264218`.
- Queried existing staging booking master `les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK` read-only and identified occupied Geranium nights 28 Aug–3 Sep 2027.
- Directly invoked deployed isolated staging quote Lambda with permitted preview origin. Geranium 28 Aug–4 Sep 2027 returned HTTP 422; combined cottages same dates returned HTTP 422. Available Geranium 3–10 Jul 2027 returned HTTP 200 and £1,085. No booking records were written.
- Remaining: test external API Gateway HTTP route/CORS; frontend quote integration; full request/approval/payment/confirmation acceptance; production release gates. Do not treat direct Lambda tests as public HTTP integration evidence.


## Consolidated acceptance register — 4 November 2026

**Operating rule:** Use the single manual workflow `.github/workflows/booking-consolidated-acceptance.yml` for the layered read-only acceptance checks. Do not rerun individual tests simply because the user says "continue". Record the run URL, commit, outcome and newly closed acceptance criteria here. Existing automated branch CI/deploy workflows may still run independently; they are not evidence of the full booking lifecycle.

| ID | Acceptance criterion | Evidence / current state | Status |
| --- | --- | --- | --- |
| A01 | Backend published-price and booking regression tests | Existing CI passed on `d9f9052`; included in consolidated job | PASSED — consolidated run 41930378226 (991afdf) |
| A02 | Live quote and exact 2027 published total | Staging quote HTTP acceptance run 41922203851; Geranium 3–10 July £1,085 | Passed |
| A03 | Occupied dates rejected | Same run; 28 Aug–4 Sept 2027 HTTP 422 | Passed |
| A04 | Wrong origin denied; browser CORS preflight permitted | Same run; HTTP 403 and OPTIONS accepted | Passed |
| A05 | Staging website deployed with quote URL in build | Staging deploy run 41925259811 passed after Python syntax correction | Passed |
| A06 | Published CloudFront HTML and served browser JS contain quote URL | Included in consolidated job; previous corrected deploy run 41925259811 passed | PASSED — consolidated run 41930378226 (991afdf) |
| A07 | Interactive browser journey and price displayed in review/details | Browser automation not yet in consolidated job | Outstanding |
| A08 | Guest request creates versioned immutable quote and atomic reservation | Not exercised end to end | Outstanding |
| A09 | Canonical management app receives request and owner approves/rejects | Not exercised end to end | Outstanding |
| A10 | Approved request creates sandbox SumUp checkout; payment verified before confirmation | Separate £1 sandbox payment tested, not full journey | Outstanding |
| A11 | Guest/owner emails, cancellation/refund, released dates and idempotency | Not exercised end to end | Outstanding |
| A12 | Production identity, isolated production booking master, security and controlled go-live | Production not authorised | Blocked |

**Single-job scope:** A01–A06 read-only. A07 needs actual browser automation. A08–A11 require a separately authorised, isolated synthetic booking lifecycle with cleanup and payment sandbox credentials; do not silently perform write/payment actions as part of a read-only workflow. A12 is a distinct production go/no-go.

**Next execution:** manually dispatch `Booking consolidated acceptance (staging, read-only)` once, record the run result, and prioritise A07–A11 rather than adding another overlapping smoke-test workflow.


## Consolidated run result and A07 investigation — 4 November 2026

- **A01–A06 PASSED together**: [consolidated acceptance run 41930378226](https://github.com/metapointgg/les-buttes-website/actions/runs/41930378226), commit `991afdfc9543508175078c1411e2693175a32728`. This replaces the need to repeat independent quote/CORS/CloudFront checks.
- Other CI, staging deployment and management validation also passed on that commit.
- **A07 remains OPEN**. Source review confirms `checkAuthoritativeQuote()` exits before fetching the staging quote unless `masterConnected()` is true; `updateNext()` likewise disables advancement when the public availability feed is disconnected. Therefore passing quote API and CloudFront tests is insufficient evidence of an interactive guest journey. Verify the public availability feed in the browser and then automate a real interaction; do not mark A07 passed from static assets.
- A08–A11 remain OPEN, A12 remains NO GO. The consolidated workflow is read-only and deliberately does not submit requests, approve, charge or send emails.
- **Next work item:** A07 browser interaction and availability dependency, then a single isolated A08–A11 synthetic lifecycle with explicit staging-only guardrails and cleanup.


## A07 quote presentation correction — 4 November 2026

- Consolidated acceptance [41932874245](https://github.com/metapointgg/les-buttes-website/actions/runs/41932874245) PASSED, including the new live public-availability response contract (fresh snapshot, season, cottage blocked arrays). Existing feature CI, staging deploy and management validation passed on `bf62115`.
- **A07 source defect identified:** after successfully fetching the authoritative quote, the review screen still rendered `indicativeDirectTotalGBP` from the preview price model. The details screen already used the authoritative quote. This allowed conflicting totals across stages.
- **Fix committed** `a8c5707`: once authoritative quote succeeds, the review total is replaced with the server quote, and illustrative Airbnb price/savings comparisons are hidden because they would compare inconsistent pricing models. Staging request and payment flags remain disabled.
- **A07 remains OPEN** until the changed build passes CI/deployment and an actual browser journey demonstrates review and details both showing the same authoritative total. Do not repeat A01–A06 without a specific regression reason.


## A07 closed; transaction acceptance scope — 4 November 2026

- **A07 PASSED**: [consolidated run 41935946600](https://github.com/metapointgg/les-buttes-website/actions/runs/41935946600), commit `22f063e445286059fe0a747b8ff3e4ebecbfe839`. Headless Chromium exercised staging /book/ search (Geranium, 3–10 July 2027), cottage selection, review, authoritative £1,085 quote, details price parity, and disabled submission. The public master contract and earlier API checks also passed in the same job.
- **A01–A07 CLOSED**. Do not rerun separate manual probes as a substitute for lifecycle acceptance.
- **A08–A11 OPEN**. Current staging browser is intentionally read-only; it cannot prove request creation, atomic reservation, owner approval/rejection, sandbox payment, email, cancellation or date release. Next acceptance job must use isolated staging-only test fixtures, synthetic guest data, SumUp sandbox, idempotency/replay assertions and cleanup, with a clear run summary per lifecycle stage. Do not enable real guest submission or production payment to accomplish this.
- **A12 BLOCKED / production NO GO** until A08–A11 and operational controls are evidenced.
