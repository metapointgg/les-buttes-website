# LB-08 isolated staging management preview — IAM prerequisite

## Verified on 3 November 2026

AWS account `145608514666` / `eu-west-2`: public booking stack is `UPDATE_COMPLETE`; authoritative booking table and `BookingRequestsIndex` are `ACTIVE`. The existing staging Cognito app client `2mjmimjh7oc8h00d4nngrc1akj` exists in pool `eu-west-2_Wvo0I3cTa` and has no client secret. AWS CloudFormation `ValidateTemplate` accepted `services/booking-api/staging-management-preview-isolated.template.yaml` with its four parameters. These checks are read-only; they do **not** mean a packaged code artefact or change set exists.

The connected GitHub Actions deployment role is `arn:aws:iam::145608514666:role/les-buttes-booking-private-staging-deploy`. Its OIDC trust policy permits the specific feature branch, but IAM policy simulation returned **implicitDeny** for all of these correctly scoped resource/action pairs:

| Action | Intended resource |
| --- | --- |
| `cloudformation:CreateChangeSet` | `arn:aws:cloudformation:eu-west-2:145608514666:stack/les-buttes-management-preview-isolated-staging/*` |
| `cloudformation:DescribeChangeSet` | Same isolated management stack |
| `cloudformation:DescribeStacks` | Existing `les-buttes-booking-staging` stack (read-only preflight) |
| `s3:PutObject` | `arn:aws:s3:::les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/booking-management-preview-isolated/sam/*` |
| `s3:GetObject` | Same prefix |

A sixth simulation for `iam:CreateRole` on the isolated stack's prospective execution-role name also returned **implicitDeny**. **This permission is not required merely to preview a change set**; do not grant IAM role creation/execution or `cloudformation:ExecuteChangeSet` for a no-execution review. A later deployment must have its own separately reviewed minimum permissions, and may require tag-on-create privileges.

## Safe next step

Have an AWS administrator review and grant **only the minimum preview-stage permissions** needed for packaging and creating/describing an unexecuted change set, constrained to the isolated stack ARN and S3 artefact prefix (plus narrowly scoped prerequisite read calls where required). The permissions simulation does not account for every possible permission boundary, session condition or service-specific policy; validate in the actual intended GitHub session before use.

Run `infra/booking-api/check-isolated-management-preview-iam.ps1` using an AWS profile authorised for IAM simulation. It performs no writes. The `prepare-isolated-management-preview-changeset.ps1 -Prepare` script now invokes this gate **before** packaging or change-set creation, failing closed if the deployment role lacks permissions.

Do not relax these guards by granting `cloudformation:ExecuteChangeSet`, blanket `iam:*`, blanket `s3:*` or access to the production/public-booking stack. Do not use the existing private availability deployment workflow: it calls `sam deploy` and would execute a change set. Once the preview role is approved and verified, create a new packaged, non-executed isolated management change set with the current GitHub source and review it before deployment.
