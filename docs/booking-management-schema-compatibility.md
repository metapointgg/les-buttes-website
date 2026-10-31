# LB-01 — Booking management transaction/schema compatibility

Reviewed 31 October 2026 against `services/booking-api/index.mjs`, `admin.mjs`, `booking-admin-reader.mjs`, `booking-admin-transaction-writer.mjs` and `monitor-airbnb.mjs`.

| Concern | Authoritative booking creation | Management writer / result |
|---|---|---|
| Metadata key | `PK=BOOKING#<uuid>, SK=META` | Same; transactional conditional update |
| Booking identity | `id=<uuid>` | Require matching requested ID and conditional `id` |
| Direct classification | `source=direct`, `GSI1PK=BOOKING_REQUESTS` | Now reject manual/imported/legacy blocks |
| Request lifecycle | `status=REQUESTED`, `reservationStatus=PENDING_REVIEW` | Require both in read and atomic condition for approve/decline |
| Confirmed lifecycle | CLI confirmation sets `status=CONFIRMED`, `reservationStatus=CONFIRMED` | Require both for cancellation |
| Allocation | `units`, `start`, `end` | Validate known cottages, unique units, valid dates, 1–27 nights |
| Date slots | `PK=UNIT#<unit>, SK=DATE#YYYY-MM-DD`, `id`, `expiresAt` | Same keys; conditional ownership; approval extends slot TTL |
| Hold expiry | `holdExpiresAt` in epoch seconds, initially 24 hours | Read check and atomic equality / greater-than-now on metadata |
| Quote | `quote.totalGBP` | Approved pence validated against quote; changed amount requires reason |
| List index | `GSI1PK=BOOKING_REQUESTS`, `GSI1SK=requestedAt#id` | Writer preserves index keys |
| Record TTL | `expiresAt` initially 90 days | Cancellation resets to 90 days; CLI confirmation removes TTL |
| Audit | No audit record at request creation | Atomic `AUDIT#` record on management transitions |
| Calendar monitoring | Read-only reconciler, no booking writes | Writer does not modify monitor state |
| Transaction capacity | 1 metadata + up to 54 slots | 1 metadata + up to 54 slots + 1 audit = 56 (under 100) |

## Findings and actions

1. **Critical, corrected:** Writer previously accepted any booking matching a status and cottage allocation. Manual or imported bookings could be affected. Restrict to direct requests with the authoritative request GSI classification.
2. **Critical, corrected:** A stale request classification could pass a status-only metadata condition. Require `reservationStatus` in the atomic DynamoDB condition.
3. **Remaining LB-02:** Slot release on decline/cancel checks ownership but not expiry or whether another process changed the booking's date allocation after read. Review all concurrency and stale-read scenarios.
4. **Remaining LB-08:** Confirmation is still host-only CLI with a manually supplied payment reference; must not be exposed through HTTP until independent SumUp verification.
5. **Remaining LB-13:** Confirm IAM privileges, TTL and GSI deployment in the actual staging account; source review is not a live AWS infrastructure inspection.

## Evidence

Unit tests: `services/booking-api/booking-admin-transaction-writer.test.mjs` including realistic `GSI1PK` and `reservationStatus` fixtures, rejected legacy sources and mismatched classifications. Full CI must pass before marking LB-01 complete.
