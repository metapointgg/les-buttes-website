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

variable "budget_alert_email" {
  type = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}
