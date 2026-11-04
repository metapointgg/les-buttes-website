# Isolated staging quote deployment — IAM prerequisite

The GitHub Actions workflow `.github/workflows/staging-quote-changeset.yml` creates a change set only. It does not execute it.

The existing OIDC role `les-buttes-booking-private-staging-deploy` currently has a policy scoped to the private availability stack, its Lambda function and its S3 prefix. **It cannot create the quote stack.**

Before manually dispatching the quote workflow, an AWS administrator must authorise a separate least-privilege grant. Do not broaden the private availability permissions to wildcard stacks, roles or buckets.

Required resource scopes:

- CloudFormation stack: `arn:aws:cloudformation:eu-west-2:145608514666:stack/les-buttes-isolated-quote-staging/*` (CreateStack, CreateChangeSet, DescribeChangeSet, DescribeStacks, GetTemplateSummary and DeleteChangeSet; ExecuteChangeSet only after a separate review).
- SAM transform: `arn:aws:cloudformation:eu-west-2:aws:transform/Serverless-2016-10-31` for CreateChangeSet.
- Artifact objects: `arn:aws:s3:::les-buttes-cottage-manag-artifacts-145608514666-eu-west-2/booking-isolated-quote-staging/sam/*` (PutObject and GetObject).
- Lambda functions and IAM execution roles generated with the quote stack's `les-buttes-isolated-quote-staging-` prefix. Include Lambda tagging and role tagging, and restrict iam:PassRole to lambda.amazonaws.com.
- API Gateway HTTP API and stage creation/tagging actions needed by SAM. Scope to staging where supported.
- DynamoDB read-only access for the existing staging booking table (GetItem, Query) is granted to the generated Lambda execution role by the SAM template, **not** to the GitHub deployment role.

Review CloudFormation's generated IAM role and API resources in the change set before executing. Avoid permitting updates to production stacks. The staging table is existing and must not be replaced or deleted.

After permissions are granted:
1. Manually dispatch the quote change-set workflow with `STAGING-QUOTE-ONLY`.
2. Inspect the change set for additions only and verify the staging-only resource names.
3. Execute only after approval; confirm `CREATE_COMPLETE`.
4. Test `/quote` for a valid week, an occupied week, invalid guests and CORS origin restrictions.

No live bookings or payments should be enabled by this operation.

## Verified blocker — 4 November 2026, 20:16 GMT

A live `iam:SimulatePrincipalPolicy` check for role `les-buttes-booking-private-staging-deploy` confirms:

| Action/resource | Decision |
|---|---|
| `cloudformation:CreateChangeSet` / isolated quote stack | `allowed` |
| `s3:PutObject` / isolated quote artefact prefix | `allowed` |
| `cloudformation:CreateChangeSet` / `arn:aws:cloudformation:eu-west-2:aws:transform/Serverless-2016-10-31` | **`implicitDeny`** |
| `cloudformation:ExecuteChangeSet` / isolated quote stack | `implicitDeny` (intentional) |

The feature-branch workflow was corrected to separate `staging` environment approval from branch-scoped OIDC credentials in commit `33816bee`. An additional preflight check for SAM transform permission was committed in `ca3498d1`. **Neither commit has been exercised by a fresh manual workflow run yet.**

**One required admin permission** (do not broaden to wildcard transforms or give ExecuteChangeSet):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "cloudformation:CreateChangeSet",
      "Resource": "arn:aws:cloudformation:eu-west-2:aws:transform/Serverless-2016-10-31"
    }
  ]
}
```

AWS connector write operations to alter IAM were blocked, so the grant **has not** been made here. Do not run the workflow expecting success until that grant is verified. Once granted, run the feature-branch manual workflow with `STAGING-QUOTE-ONLY`. Its sole objective is to prepare the staging change set for separate review; never execute automatically.

For clarity: IAM simulator checks of subsequent Lambda/role creation actions returned `implicitDeny` for the deploy role, which is expected for a change-set preparation role and **does not alone prove the separately authorised CloudFormation execution stage lacks permissions**. Verify execution permissions separately during review.
