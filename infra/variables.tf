variable "aws_region" { type=string default="eu-west-2" }
variable "domain_name" { type=string default="lesbuttes.com" }
variable "hosted_zone_id" { type=string default=null nullable=true }
variable "existing_certificate_arn" { type=string default=null nullable=true }
variable "github_repository" { description="GitHub owner/name" type=string }
variable "budget_alert_email" { type=string }
variable "monthly_budget_usd" { type=number default=5 }
