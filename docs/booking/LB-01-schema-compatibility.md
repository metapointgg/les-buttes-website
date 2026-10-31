# LB-01 — Booking schema compatibility review

Reviewed 31 October 2026. Scope: code-level comparison, **not** live DynamoDB inspection or deployment. Source files: `index.mjs`, `admin.mjs`, `booking-admin-reader.mjs`, `booking-admin-transaction-policy.mjs`, `booking-admin-transaction-writer.mjs`, `monitor-airbnb.mjs`.

| Concern | Authoritative creation / CLI | Isolated management writer | Finding |
| --- | --- | --- | --- |
| Booking metadata key | `PK=BOOKING#<uuid>, SK=META` | Same | Compatible |
| Cottage-night key | `PK=UNIT#<unit>, SK=DATE#YYYY-MM-DD` | Same | Compatible |
| Slot owner | `id=<uuid>` | Conditional `id=:id` | Compatible; prevents release of another booking |
| Direct request state | `REQUESTED`, `reservationStatus=PENDING_REVIEW` | Approve to `APPROVED_AWAITING_PAYMENT` / `AWAITING_PAYMENT` | Compatible |
| Decline | CLI `DECLINED`, direct reservationStatus `DECLINED` | Same | Compatible |
| Cancel | CLI `CANCELLED`, direct reservationStatus `CANCELLED`, reason, cancelledAt, 90-day record TTL | Same | Compatible |
| Request hold | `holdExpiresAt` epoch seconds; slots `expiresAt` epoch seconds | Checks both; metadata checks observed expiry | Compatible |
| Approval | CLI `approvedAmountGBP`, `paymentUrl`, 48-hour hold | Same; pence input normalised to GBP | Compatible; quote change reason required |
| Guest quote | `quote.totalGBP` | Used for approval comparison | Compatible; ensure exact currency rounding |
| Booking list index | `GSI1PK=BOOKING_REQUESTS`, `GSI1SK=requestedAt#id` | Does not change index attributes | Compatible |
| Audit | No audit item in request creation or old CLI | `BOOKING#id / AUDIT#timestamp#uuid` put in same transaction | New record type; does not interfere with metadata get or slot queries |
| Slot limits | `validBooking` maximum 27 nights; up to two units | 54 slots + metadata + audit = 56 writes | Within 100-item transaction limit |
| Strong reads | Reader `GetCommand ConsistentRead:true` | Injected `readBooking` function | **Integration requirement:** caller MUST supply consistent read; currently no HTTP writer |
| Airbnb monitor | Queries `UNIT#` slot partitions, metadata `SK=META` | Audit uses booking partition, not unit partition | No slot-query interference |
| Booking date validation | `rules.mjs` validates dates | Previously `new Date(NaN).toISOString()` could throw | **Fixed in LB-01**; malformed/absent dates now return denied decision |

## Findings and follow-up

1. **Fixed:** invalid date strings or absent dates could trigger a `RangeError` in transaction preflight rather than a controlled denial. Added tests.
2. **LB-02:** enforce cancellation slot ownership and non-expired/confirmed-slot semantics against races; verify transaction cancellation behaviour and idempotency. Existing cancellation checks slot `id`, which intentionally fails closed if reassigned.
3. **LB-02:** enforce metadata/source and booking allocation immutability in the transaction or ensure equivalent safeguards; a consistent read alone does not prevent all concurrent metadata changes.
4. **LB-04:** construct the writer with a **strongly consistent** `GetCommand` reader and staging-only IAM, not the public read-only management reader without explicit authorisation.
5. **LB-07/08:** approval URL validation is not payment verification; confirmation must be based on independently verified SumUp payment data.
6. **Operational note:** old `admin.mjs` CLI remains a separate mutation implementation and does not append the new audit records. Decide whether to migrate the CLI to the shared writer before enabling management actions; avoid assuming a complete audit history for legacy CLI actions.

## Evidence

- Compatibility review: this document, source code listed above.
- Malformed-date correction and regression tests: commits `b6aa66b` and `3609ee1`.
- Acceptance requires CI success on the final documentation commit. No production resources changed.
