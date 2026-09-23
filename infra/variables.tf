variable "aws_region" {
  type    = string
  default = "eu-west-2"
}

variable "domain_name" {
  type    = string
  default = "lesbuttes.com"
}

variable "custom_domain_enabled" {
  description = "Use the custom domain and an ACM certificate instead of the temporary CloudFront URL"
  type        = bool
  default     = false
}

variable "hosted_zone_id" {
  type     = string
  default  = null
  nullable = true
}

variable "existing_certificate_arn" {
  type     = string
  default  = null
  nullable = true
}

variable "github_repository" {
  description = "GitHub repository in owner/name format"
  type        = string
}

variable "github_oidc_subject" {
  description = "Exact GitHub Actions OIDC subject allowed to assume the deployment role"
  type        = string
  default     = "repo:metapointgg@93396632/les-buttes-website@1384090441:ref:refs/heads/main"
}

variable "github_oidc_provider_arn" {
  description = "ARN of an existing GitHub Actions OIDC provider; leave null to create one"
  type        = string
  default     = null
  nullable    = true
}

variable "budget_alert_email" {
  type = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}
