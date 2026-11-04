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
