output "site_bucket" {
  value = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  value = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github.arn
}
