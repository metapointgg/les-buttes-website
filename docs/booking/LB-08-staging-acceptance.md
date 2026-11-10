# LB-08 — Staging payment acceptance checklist

**Scope:** Non-production testing only. Do not enable live merchant payments or merge/release without owner approval.

## Preconditions

- Staging DynamoDB booking table is isolated, with TTL and PITR configuration checked.
- Dedicated least-privilege staging IAM role is authorised for GetItem, conditional PutItem and TransactWriteItems against the exact table.
- Staging SumUp merchant supports GBP and the Guernsey account, with test API key stored outside source control (SSM SecureString or Secrets Manager).
- Verify live documentation against actual sandbox response bodies; the payment policy deliberately rejects unknown provider fields or statuses.
- Staging booking is synthetic, with a valid approved quote, unexpired hold, registered checkout and free/owned cottage-night slots.
- Internal HMAC signing secret is private to authorised service roles. The existing HMAC internal trigger is NOT an authenticated SumUp external webhook endpoint.

## Reproducible acceptance matrix

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| PAY-01 | Checkout API returns PENDING | No booking confirmation or released slot expiry |
| PAY-02 | Checkout PAID and exactly one matching SUCCESSFUL transaction | Single atomic confirmation plus seven owned slot updates and immutable audit/transaction records |
| PAY-03 | Checkout paid but amount or currency differs | Fail closed, no DynamoDB booking transition |
| PAY-04 | Checkout paid but merchant or reference differs | Fail closed, no booking transition |
| PAY-05 | Transaction-level amount, currency or merchant differs | Fail closed, no booking transition |
| PAY-06 | Hold expires between read and transactional write | Conditional transaction rejects; no partial writes |
| PAY-07 | One cottage-night belongs to another booking | Entire transaction rejects; conflicting slot remains untouched |
| PAY-08 | Concurrent duplicate confirmation invocations | Exactly one success; other invocation detects authoritative confirmation without duplicate audit |
| PAY-09 | Network disconnect after successful transaction | Strongly consistent re-read verifies booking and immutable transaction claim before reporting already confirmed |
| PAY-10 | Tampered or expired internal HMAC trigger | No provider read or database write |
| PAY-11 | Identical internal trigger delivered twice | Conditional replay claim prevents duplicate invocation |
| PAY-12 | Provider unavailable after trigger claim | No booking update; manual investigation required |
| PAY-13 | Failed transaction and duplicate transaction identifier | Never confirm booking and never reassign a provider transaction to another booking |
| PAY-14 | Public HTTP notification received | Must not be capable of triggering reconciliation until provider-specific authentication and exposure review are approved |

## Evidence to capture

For each case record timestamp, isolated stack name, masked booking reference, git SHA, test output, expected/actual result, anonymised provider schema sample and relevant CloudWatch trace IDs. Never commit API keys, card data, personally identifiable guest details or complete unredacted provider payloads.

## Go/no-go criteria

Do not mark LB-08 complete until PAY-01–PAY-13 pass in staging with real DynamoDB semantics, actual SumUp sandbox PAY-01–PAY-05 evidence is recorded, and the external notification design in PAY-14 is approved or replaced with an explicitly authorised secure alternative. Document IAM, monitoring and failure recovery. No production deploy is part of this checklist.
