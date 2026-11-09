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
5. **Email delivery:** the 8 November check found `lesbuttes.com` verified with successful DKIM in `us-east-1`, the code's configured sending region; `eu-west-2` remains unverified. Staging guest/owner emails are disabled and deliverability is untested. Complete an authorised recipient test and delivery/retry acceptance before release.
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
| A08 | Guest request creates versioned immutable quote and atomic reservation | 8 Nov: actual guest HTTP request, £735 Geranium quote version 3, seven atomic holds, competing HTTP request rejected | Passed for synthetic staging API |
| A09 | Canonical management app receives request and owner approves/rejects | 8 Nov: deployed canonical owner-action Lambda approved the new request; seven holds extended. Browser sign-in is still required to verify the authenticated UI route | Backend passed; browser acceptance open |
| A10 | Approved request creates sandbox SumUp checkout; payment verified before confirmation | 8 Nov: same request paid £735 through SumUp hosted sandbox and 3DS simulator; deployed reconciler independently verified provider and committed CONFIRMED; replay ALREADY_CONFIRMED, one audit | Passed for staging backend/provider transaction |
| A11 | Guest/owner emails, cancellation/refund, released dates and idempotency | 8 Nov: public staging feed blocked confirmed dates; cancellation released all seven slots and restored quote HTTP 200. Emails disabled; external calendar import and refund acceptance remain unverified | Partial |
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


## Production readiness checkpoint — 5 November 2026

**Planning estimate: ~75%** (subjective readiness, not 7/12 test-count arithmetic). **NO GO** for live bookings.

**Recheck evidence:** commit `0a45396` passed feature CI [41937213380](https://github.com/metapointgg/les-buttes-website/actions/runs/41937213380), isolated preview deployment [41937213392](https://github.com/metapointgg/les-buttes-website/actions/runs/41937213392), and management validation [41937213328](https://github.com/metapointgg/les-buttes-website/actions/runs/41937213328). A07 browser acceptance remains evidenced by [41935946600](https://github.com/metapointgg/les-buttes-website/actions/runs/41935946600).

**Implementation-level A08–A11 audit (not acceptance evidence):**
1. `services/booking-api/index.mjs` has atomic `TransactWriteCommand` for request metadata plus nightly slots and persists a published quote, but the staging guest API requires a private `STAGING_API_TOKEN`, Turnstile verification, and `BOOKING_REQUESTS_ENABLED=true`. The public read-only browser deliberately cannot submit. Need an isolated, credential-safe synthetic request harness; never expose the staging token to browser JavaScript.
2. `services/booking-api/admin.mjs` supports conditional owner approve/decline and atomic slot release. Approval records an owner-supplied payment URL and prints a **manual** guest email template; it does not itself issue or validate a SumUp checkout.
3. `admin.mjs confirm` explicitly rejects manual confirmation and requires server-side verified SumUp reconciliation. The reconciler must be identified and exercised against a sandbox checkout with duplicate/replay checks before A10 passes.
4. `admin.mjs cancel` releases confirmed booking slots but states that SumUp refunds and guest notifications must be handled separately. `index.mjs` suppresses owner email in staging. A11 requires explicit tests of outbound delivery, refund reconciliation and cancellation notification, not just date release.
5. The existing production master and SES/DKIM release blockers described above remain unresolved; no production migration or public submission should occur as a shortcut.

**Next ordered implementation:** identify the existing SumUp reconciler and its acceptance harness, then create one guarded isolated staging lifecycle test that runs A08 request/atomic hold → A09 owner approval/rejection → A10 provider-verified sandbox payment/idempotency → A11 cancellation/release and notification/refund evidence, with deterministic synthetic fixture and cleanup. Do not mark the lifecycle passed on the strength of the source audit alone.


## 5 November 2026 — A08–A11 existing harness audit and safety correction

- Latest pre-change checks on `e3302cd` passed: feature CI 41938462184, preview deployment 41938462473 and management validation 41938462403.
- Existing `services/booking-api/lb08-isolated-booking-acceptance.mjs` already provides a guarded disposable-table acceptance against `les-buttes-lb08-staging-isolated-acceptance`: seeds synthetic approved booking and seven date slots, exercises `reconcileVerifiedPayment` using a synthetic paid provider fixture, strongly reads confirmed booking/slots/transaction claim, rejects replay, verifies one audit record, and cleans up its owned records. It **does not** create a real SumUp checkout, exercise guest request creation, owner approval, SES or refund.
- `services/booking-api/sumup-payment-internal-e2e.test.mjs` covers signed internal trigger, paid/unpaid provider outcomes, tampering, concurrent replay and failed reconciliation in a mock environment. These are unit/integration tests, **not** live end-to-end evidence.
- **Safety defect corrected** in commit `bc66b77`: obsolete `services/booking-api/staging-e2e.mjs` still expected `admin.mjs confirm` to succeed, despite that command now intentionally refusing manual payment proof. The legacy script now fails closed before creating any synthetic date holds. Use LB-08 acceptance instead.
- **A08–A11 remain OPEN:** execute existing guarded LB-08 acceptance with authorised isolated-table credentials, then extend the consolidated acceptance design to cover request/approval/checkout and email/refund evidence without production writes or false claims of actual provider payment.

## 6 November 2026 — A08 isolated DynamoDB acceptance PASSED; A09 in progress

- **A08 PASSED** in GitHub Actions [run 42282987021](https://github.com/metapointgg/les-buttes-website/actions/runs/42282987021), commit `ba8f5e1`, AWS account `145608514666`, region `eu-west-2`, dedicated table `les-buttes-lb08-staging-isolated-acceptance` only.
- Real DynamoDB transaction verified seven atomic nightly holds, competing-booking collision rejection, no orphan booking, synthetic pricing snapshot and strongly consistent cleanup.
- Separately, real DynamoDB payment-reconciliation transaction with **synthetic SumUp PAID fixture** verified seven confirmed nights, transaction claim, one audit record, replay rejection and cleanup. **No actual SumUp charge or production booking** was involved.
- The acceptance role has narrowly scoped DynamoDB permissions including `ConditionCheckItem`; the full workflow is green.
- **A09 NEXT:** execute owner approval/decline transitions against the isolated table with atomic slot updates/releases and audit readback, using the existing `booking-admin-transaction-writer.mjs`. Current `booking-admin-transaction-writer-a09.test.mjs` is unit-level only and does not constitute live AWS acceptance. Wire acceptance to the canonical management app separately before claiming end-to-end owner operations.
- **Release decision remains NO GO.** A08 success does not establish live payment settlement, SES deliverability, production environment isolation, Airbnb synchronisation or production approval.

## 6 November 2026 — A09 isolated AWS acceptance and CI recovery

- **A09 isolated owner approval/decline PASSED** in [run 42286206659](https://github.com/metapointgg/les-buttes-website/actions/runs/42286206659). The workflow executes `a09-isolated-owner-transition-acceptance.mjs` against the dedicated isolated staging table and validates transactional owner approval, decline, slot extension/release, audit and cleanup. This does **not** prove that the canonical management app's deployed API is enabled or connected to a guest request.
- Existing `booking-admin-http.mjs` already wires Cognito-authorised owner POST actions to `executeOwnerTransition` behind `MANAGEMENT_WRITES_ENABLED` and `MANAGEMENT_APPROVAL_ENABLED` flags. **Do not build a duplicate API.** Next verify canonical management app deployment and end-to-end owner action against the actual staging booking master, using synthetic reservations only and explicit staging controls.
- Root direct-booking CI failed on npm dependency metadata resolution in [run 42286206714](https://github.com/metapointgg/les-buttes-website/actions/runs/42286206714), then **PASSED** in [run 42287128579](https://github.com/metapointgg/les-buttes-website/actions/runs/42287128579) following the registry preference change in commit `012a72b`.
- Production remains **NO GO** pending separate release gates.

## 6 November 2026 — canonical management deployment verification (live AWS read-only)

- GitHub Actions at commit `37674db`: [A08/A09 isolated acceptance 42300642954](https://github.com/metapointgg/les-buttes-website/actions/runs/42300642954), [direct-booking CI 42300642899](https://github.com/metapointgg/les-buttes-website/actions/runs/42300642899), management staging validation and preview website deployment all **PASSED**.
- Read-only AWS inspection of account `145608514666`, `eu-west-2` identified the **canonical** management Lambda as CloudFormation `ApiFunction` physical resource `les-buttes-cottage-management-ApiFunction-NtF6QjkvsE3v` (last modified 27 October 2026), not a function named after the stack.
- That Lambda has `BOOKING_MASTER_TABLE=les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK`, `BOOKING_MASTER_ENVIRONMENT=staging`, `BOOKING_MASTER_ACTIONS_ENABLED=true`, plus pricing approval/publication and draft-write flags enabled. These flags are for the canonical management service, **not proof that the separate `booking-admin-http.mjs` Lambda is deployed**.
- API Gateway `i2irz87c82` route inventory found `POST /admin/bookings/{bookingId}/payment/reconcile` with JWT authorisation, but **no** `POST /admin/bookings/{bookingId}/actions/{action}` route. Therefore A09 is **not yet available through the canonical management API** despite isolated AWS acceptance.
- **Next implementation gate:** inspect the canonical management application's existing booking-action route contract and its Lambda code before changing infrastructure. Integrate the transactional A09 owner writer using the existing management app, JWT authorisation, explicit staging feature flag and narrow IAM; create a reviewed staging change set and verify against synthetic staging records. Do not expose the isolated harness or silently point canonical management at the isolated test table.
- **Production remains NO GO.** No AWS resources or booking records were modified during this read-only audit.

## 8 November 2026 — one database-priced request paid and confirmed in SumUp sandbox

**Scope:** AWS account `145608514666`, booking resources in `eu-west-2`, branch `feature/direct-booking-requests-27-night`. No live payment or production booking was enabled.

**Implementation and deployments**
- `2e4d7d7d1df4166577e8d9077398b125b79f70d7`: restored the existing deployed synthetic guest handler to source control, replaced its divergent quote path with `quoteFromPublishedMaster`, retained atomic nightly holds and hourly quotas, and rejected non-test guest identities. An explicit staging-only Cloudflare test switch supports the documented dummy-token response; the existing private secret remains unchanged.
- Existing stack `les-buttes-booking-guest-staging` updated via reviewed change set `guest-published-pricing-2e4d7d7`; no replacements, no new resources. Deployed package SHA-256 (base64): `/twDrNn9qtKBUtbxof87WfPU3LPqML2/TcEF4kXbneU=`.
- `5c185d8e5ad7ce70c41540f5eb7569f494a997c1`: corrected the payment Lambda's table-scoped IAM actions to `PutItem`, `UpdateItem` and `ConditionCheckItem`, made repeat reconciliation validate provider evidence plus the immutable transaction claim, and removed temporary TTL fields from confirmed booking metadata.
- Existing stack `les-buttes-payment-reconciliation-route-staging` updated via reviewed change set `payment-confirmation-5c185d8`; no replacements, same JWT-protected route and staging table. Sandbox reconciliation enabled, email flags remain disabled. Deployed package SHA-256 (base64): `Nq7ycvhI5kNV9+MEC2TKdGMSVii2kXTVnl6afJcgFZ0=`.
- Backend suite: **376 passed, 0 failed**. Both changed CloudFormation templates passed cfn-lint; AWS change-set validation reported no validation errors.
- GitHub checks on `5c185d8` all passed: [feature CI 42535556703](https://github.com/metapointgg/les-buttes-website/actions/runs/42535556703), [preview deployment 42535556702](https://github.com/metapointgg/les-buttes-website/actions/runs/42535556702), published-pricing release gate, payment-route authoriser smoke, owner/payment packages, management validation and quote-package validation.

**Single transaction evidence**
1. Public staging quote returned **£735.00** for Geranium, **3–10 April 2027**, two guests.
2. `POST https://75im3kpaq6.execute-api.eu-west-2.amazonaws.com/request` returned HTTP **201**, synthetic booking `75e1dd6b-11a5-43ed-82a3-890063dfca90`, published Geranium pricing **version 3**, same **£735.00**. Synthetic identity only.
3. Deployed owner-action Lambda approved that record at its published quote and extended **seven** nightly holds. This used an authorised AWS Lambda integration event with fixture owner claims; it is **not evidence of browser JWT authentication**.
4. Deployed checkout Lambda registered sandbox checkout `a42efccb-b26b-47af-a080-c38fd7f43574` for **73,500 pence**. SumUp hosted checkout displayed **Test mode**. Its documented test card and 3DS simulator completed successfully, receipt **TAAA7D2MG3D**.
5. Deployed reconciliation Lambda independently retrieved SumUp payment evidence and returned **CONFIRMED** at **23:34:47 UTC**. Provider transaction ID `1e8553ef-b947-4e30-8416-b75c1f366b00`. Strongly consistent reads verified the confirmed booking and seven non-expiring nightly slots; booking metadata had no temporary TTL.
6. Repeated verification returned **ALREADY_CONFIRMED**, with exactly **one** payment-confirmation audit record. The public staging availability feed blocked **3–10 April**, quote returned **422**, and a competing guest request returned **409**.
7. Cleanup used the deployed owner cancellation action: **CONFIRMED → CANCELLED**, seven slots released. Strong read found **zero** remaining test slots. Public availability removed the test range and the quote returned **200 / £735.00** again. Synthetic audit/payment evidence was retained; no real-money refund was involved.
8. An unauthenticated request to the canonical owner checkout-status HTTP route returned **401**.

**Remaining acceptance boundaries**
- Owner browser sign-in subsequently succeeded, but the canonical booking screen returned HTTP 403, `Management access required`. The 9 November entry below records the reproduced defect and prepared correction. Complete authenticated browser approval/checkout/reconciliation before closing A09 UI acceptance. The public preview remains read-only; synthetic submission was exercised through HTTP.
- Confirmation response explicitly reported `guestNotificationSent:false`, `notificationStatus:DISABLED`. No guest/owner email was sent. The existing SES identity is currently verified in `us-east-1` (the code's explicit sending region), while `eu-west-2` verification is failed; do not reuse the old blanket statement that all SES sending identities are unverified.
- Staging availability synchronisation is verified within the shared booking master and public feed. Actual Airbnb import/propagation, guest correspondence, refund workflow and automatic post-payment triggering are not established by this transaction.
- Production remains **NO GO** pending those functional/operational gates, deliberate production data/configuration isolation and explicit owner approval. Do not label this an accepted complete customer-facing production journey.

## 9 November 2026 — owner browser access correction prepared; production approval required

- The existing owner signed in successfully to `https://lesbuttes.ozanne-family.com/`. Bookings and availability then displayed `API 403: Management access required`; policy drafts also returned 404. Read-only Cognito inspection verified existing `management`, `lesbuttes-owner` and `lesbuttes-viewer` membership. No account permissions were changed.
- The deployed PWA still calls `/booking-master/...` in the older Python operations Lambda, not the newer `/admin/bookings/...` staging Lambda routes. Its comma-only `_groups` parser rejects API Gateway's supported space-separated group representation. Direct read-only Lambda reproduction returned **403** for `[management lesbuttes-viewer lesbuttes-owner]` and **200** for the equivalent array. This reproduces the defect without extracting browser tokens.
- Corrected the complete group parser on the existing companion branch `metapointgg/les-buttes-cottage-management:feature/bookings-in-existing-pwa`, commit [`8f7be67749a2f37779115e180b92ce7ca7cd7eda`](https://github.com/metapointgg/les-buttes-cottage-management/commit/8f7be67749a2f37779115e180b92ce7ca7cd7eda). Exact existing role names are retained; malformed claims and role lookalikes are rejected. **108 Python tests passed**, plus all **three route-level authentication regressions** against the actual prepared deployment package.
- The package was built from the currently deployed Lambda code, changing only `_groups` and adding its `re` import. All other Python files are byte-identical; an AST comparison verified no unrelated application-code changes. This deliberately excludes undeployed policy/editor changes from the companion feature branch.
- Package SHA-256 (base64): `w4A16bq2vXOUE6lMzNlny89jXzqe66XmbZ4TrLu0Uno=`. Stored at `s3://les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/deployments/management-auth/8f7be67749a2f37779115e180b92ce7ca7cd7eda.zip`; uploaded length and MD5 verified.
- Prepared CloudFormation change set **`management-auth-groups-8f7be677`**, stack **`les-buttes-cottage-management`**, account **`145608514666`**, region **`eu-west-2`**. Review status **CREATE_COMPLETE / AVAILABLE**. Its **only** change is `ApiFunction.Properties.Code.S3Key`; **no replacement**, IAM, environment, database, API route or frontend changes. Change-set ARN: `arn:aws:cloudformation:eu-west-2:145608514666:changeSet/management-auth-groups-8f7be677/42ab2b12-20bc-48c4-9cc3-be30c5f58864`.
- **Not executed:** this Lambda also serves the live operations app, so the user's consequential-production-change approval boundary applies. On approval, execute the reviewed change set, verify deployed hash and authenticated inbox/availability, then continue wiring the existing owner screen to the verified sandbox checkout/reconciliation routes. Do not activate customer bookings or live payments.
- CloudFormation lint reported no errors and the same two pre-existing `W1030` warnings on the original and proposed templates (the optional `CognitoEmailSourceArn` empty default). The change set does not alter that parameter or email configuration.
- The backend/provider transaction remains passed. Full guest/owner browser acceptance, guest correspondence, automatic payment follow-up, Airbnb propagation, refund workflow and production release gates remain open.
