# LB-08 — Staging payment execution IAM and deployment gate

This is a **deployment design**, not evidence of AWS access or of deployment. The currently deployed read-only private availability Lambda must **not** be granted payment write permissions.

## Dedicated execution role

Use a separate payment reconciliation Lambda with `BOOKING_ENVIRONMENT=staging` and an explicit disabled-by-default deployment parameter. Do not expose a public HTTP route. The execution role must be scoped to the exact **staging** DynamoDB booking table ARN, never `*` or the production table.

| Operation | Required permission | Scope |
|---|---|---|
| Strongly consistent booking and checkout reads | `dynamodb:GetItem` | Staging booking master |
| Atomically claim signed internal triggers | `dynamodb:PutItem` | Staging booking master |
| Confirm booking, owned nights, payment transaction claim and audit together | `dynamodb:TransactWriteItems` | Staging booking master |
| Read private SumUp sandbox API key and internal HMAC secret | `ssm:GetParameter`, plus `kms:Decrypt` only where the parameter encryption key requires it | Exact staging parameter ARN(s) and required KMS key |
| Observability | CloudWatch Logs scoped to the dedicated function | Staging log group |

A separate restricted **deployment** principal, not the Lambda execution role, may need `iam:CreateRole`, `iam:TagRole`, `iam:PutRolePolicy`, `iam:PassRole` and lifecycle permissions for the deployment-created IAM role. Scope these to a dedicated role prefix and enforce a permission boundary. The earlier `iam:CreateRole`/tagging failure is a deployment-principal issue and must not be solved by broadening the runtime Lambda permissions.

## Safe staging sequence

1. Inspect the current staging CloudFormation stacks, actual booking table ARN, deployment role and permissions boundary. Do not assume these exist or that GitHub CI success means deployment success.
2. Obtain owner approval for the dedicated staging-only change set. Deploy with payment reconciliation and notifications disabled.
3. Validate least-privilege role creation and assumed runtime permissions; confirm access to production table and live SumUp credentials is denied.
4. Verify booking-master table keys and slot records before testing any transactional writes.
5. Run `payment-staging-preflight.mjs` without printing secrets.
6. Execute `LB-08-staging-acceptance.md` cases against isolated test bookings and SumUp sandbox, retaining masked evidence.
7. Only after provider contract, authentication and real DynamoDB tests pass, review a separately approved payment route and operational rollout.

## Deployment blockers (unverified at time of writing)

- GitHub role previously failed `iam:CreateRole` and tagging during CloudFormation creation.
- Actual deployed staging stack configuration, table permissions and dedicated payment Lambda have not been inspected in this step.
- SumUp sandbox API key, GBP/Guernsey eligibility and webhook authentication have not been validated.

**No production stack, production table, production IAM role or live payments may be changed as part of LB-08 staging preparation.**
