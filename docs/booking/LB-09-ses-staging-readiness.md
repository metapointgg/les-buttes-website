# LB-09 — Staging SES sender readiness and launch gate

**Read-only live check: 3 November 2026, AWS account 145608514666, eu-west-2.**

AWS SES `ListIdentities` includes `lesbuttes.com` and `ozanne-family.com`. However, `GetIdentityVerificationAttributes` reports **Failed** for `lesbuttes.com` and **Success** for `ozanne-family.com`. `GetIdentityDkimAttributes` reports `DkimEnabled=true` and **DkimVerificationStatus=Failed** for `lesbuttes.com`. AWS reports Max24HourSend 50,000, but **quota does not prove sender identity readiness**. No email was sent during inspection.

## Required remediation

1. Review the SES domain-identity verification requirements and the exact DKIM DNS records displayed for `lesbuttes.com` in the eu-west-2 console. Check the live public DNS records against SES rather than replacing records from memory. Where DNS is hosted in another service, make only the approved record changes.
2. Recheck `GetIdentityVerificationAttributes` and `GetIdentityDkimAttributes` until both the domain verification and DKIM verification are `Success`. **Do not** enable automatic guest messages or send test guest-facing email from `lesbuttes.com` before this gate passes.
3. Implement LB-09 SES staging template and durable outbox/idempotency logic, with unit tests for approved/payment instructions, decline, confirmed, cancellation, hold expiry and failure/retry scenarios. Separate sender identity, staging recipient restrictions and production rollout.
4. Verify a staging message to an explicitly approved test mailbox, delivery/failure signals and non-duplication. Then approve sender/domain and communication wording separately for production.

This is an independent blocker from LB-08 (SumUp transaction verification and payment status). The existing **read-only isolated management stack** work is staging infrastructure prerequisite, not completion of LB-08's payment webhook acceptance criteria.

**Status:** LB-09 remains unchecked; domain/DKIM fix and SES-integrated staging delivery acceptance are outstanding.
