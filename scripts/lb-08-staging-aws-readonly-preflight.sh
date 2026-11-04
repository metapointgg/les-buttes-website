#!/usr/bin/env bash
# LB-08 read-only AWS staging IAM preflight. No create/update/deploy operation.
set -euo pipefail
REGION="${AWS_REGION:-eu-west-2}"
STACK="${STAGING_STACK_NAME:-les-buttes-private-availability-staging}"
if [[ "$REGION" != "eu-west-2" || "$STACK" != *staging* ]]; then
  echo "Refusing non-staging AWS target" >&2; exit 2
fi
echo "AWS caller (review account and ARN; do not share credentials)"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
echo "Staging stack state"
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
 --query 'Stacks[0].{Status:StackStatus,Name:StackName}' --output json
echo "Staging stack resource states (no secret parameters)"
aws cloudformation describe-stack-resources --region "$REGION" --stack-name "$STACK" \
 --query 'StackResources[].{Type:ResourceType,Status:ResourceStatus,Id:LogicalResourceId,Reason:ResourceStatusReason}' --output table
echo "IAM policy simulation is NOT run: it requires a confirmed exact deployment-role ARN."
echo "Read-only inspection complete. No AWS resources have been changed."
