# LB-01 Booking schema review

Compared index.mjs, admin.mjs, booking-admin-reader.mjs, booking-admin-transaction-policy.mjs and booking-admin-transaction-writer.mjs.

| Item | Finding |
| --- | --- |
| Booking metadata | PK BOOKING#id / SK META matches writer |
| Date slots | PK UNIT#unit / SK DATE#date matches writer |
| Slot owner | id condition matches creator |
| Stay length | 27-night cap and departure-exclusive slots match |
| Holds | holdExpiresAt is epoch seconds; writer checks observed expiry |
| Payment | quote.totalGBP matches; payment verification deliberately excluded |
| GSI | GSI1PK BOOKING_REQUESTS and GSI1SK retained by writer |
| Audit | AUDIT# records share booking PK; retrieval remains LB-03 |
| Capacity | Maximum 54 date slots plus metadata and audit fits transaction limit |

Critical defect fixed: transaction-policy referenced undefined validDate, causing valid dates to fail. Replaced with UTC round-trip date checks.

Follow-ups: LB-02 must test races and amount precision; LB-03 audit reads; LB-04 verify staging IAM and deployed table/index; LB-08 independent SumUp verification. This is source-level compatibility only, not a deployment test.
