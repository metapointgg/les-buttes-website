# LB-07 — SumUp hosted checkout contract (staging only)

**Status:** Client and mocked tests committed; no provider credentials or real API requests. No checkout is created by an HTTP management route yet.

## Contract

The backend creates `POST https://api.sumup.com/v0.1/checkouts` using a **SumUp sandbox merchant**, a server-held `sup_sk_test_` API key, `checkout_reference` (unique booking/payment-attempt reference, maximum 64 characters), `merchant_code`, `amount` in GBP major units, `currency: GBP`, and `hosted_checkout: {enabled:true}`. The response must match the requested reference, amount, merchant and currency, have status `PENDING`, and provide an HTTPS `checkout.sumup.com` hosted URL. Save the checkout ID and URL against the booking using a conditional transaction *before* sharing it. The client deliberately does not perform that write or mark a booking paid.

The Hosted Checkout session is available for about **30 minutes**; the booking hold is a separate lifecycle and must not be inferred from checkout expiry. Creation alone does not charge a card. SumUp checkout creation may return HTTP 409 for duplicate references; reconcile by querying the provider rather than issuing a fresh untracked checkout.

## Secrets and environment separation

Create a sandbox merchant and API key in the SumUp developer dashboard. Store the key in a dedicated AWS SSM SecureString or Secrets Manager secret, never CloudFormation plaintext, frontend code, logs, or the repository. Scope IAM to the one staging secret, with KMS decrypt where necessary. No production credentials, live merchant, or automatic activation. `createSumUpClient` requires an explicit enabled flag and a sandbox key prefix.

## Reconciliation boundary (LB-08)

On webhook, redirect, expiry, or retry, retrieve `GET /v0.1/checkouts/{checkout_id}` from SumUp. Verify checkout ID, reference, merchant, GBP amount, booking identity and successful status, and check successful transaction evidence before any booking confirmation. Deduplicate events, handle asynchronous failures, and preserve an audit trail. A browser redirect or webhook payload alone must **never** confirm a booking.

## Prerequisites before enabling checkout creation

- Confirm SumUp sandbox merchant supports hosted checkout for Guernsey and GBP.
- Configure and test dedicated sandbox API key/merchant and secret access.
- Implement conditional persistence and duplicate-reference reconciliation before returning the hosted URL.
- Align owner approval, amount changes and checkout expiry with booking hold policy.
- Complete LB-08 provider verification and synthetic end-to-end testing before any guest-facing flow.

Source: https://developer.sumup.com/api/checkouts/create/ and https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
