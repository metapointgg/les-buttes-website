# LB-02 — Atomic owner action concurrency review

## Transaction guarantees

All metadata updates, cottage-night slot updates/deletes, and the immutable audit insert are one DynamoDB `TransactWriteCommand`. Any failed condition cancels the entire transaction. The booking state must match the action's source status and direct reservation state. The update also requires the observed cottage list, start and end dates to remain unchanged after the strongly consistent read. Approval and decline require an unchanged, unexpired hold; approval requires each slot still to belong to the booking and be unexpired. Decline now also requires each slot to remain unexpired and owned by the booking. Cancellation requires slot ownership but deliberately does not require an expiry because confirmed reservations can have non-expiring slots.

## Race scenarios

| Scenario | Expected result |
|---|---|
| Two owners approve/decline same request | One wins; status conditional prevents second transition |
| Hold expires between read and write | Metadata hold condition fails; no audit or partial release |
| Slot expires and is reused before action | Slot ownership / expiry check fails; no partial release |
| Cottage allocation or dates change after read | Metadata allocation condition fails; no stale slot mutation |
| Confirmation races cancellation | Status/reservation status condition rejects stale action |
| Repeat owner request | State transition condition rejects duplicate; unique audit key cannot overwrite |
| Quote changed after read | Atomic equality condition on stored quote prevents stale approval |
| Provider payment event replay | Not implemented; LB-08 |
| Transaction item limit | At most 54 nights + metadata + audit = 56 items |

## Remaining constraints

- **Stale quote**: approval now compares the entire observed quote in the metadata condition; a concurrent quote change aborts the transaction.
- **Approval payment URL**: current isolated writer accepts a URL supplied by the host; live SumUp checkout generation/verification is LB-07/08.
- **Idempotency**: repeat calls fail safely rather than returning the first response; explicit request-token tracking can be added to LB-04.
- Tests currently assert transaction shape and failure propagation with a mock, not a live DynamoDB race. Staging integration tests are required in LB-12.
- Never enable owner HTTP writes or production deployment based solely on these tests.
