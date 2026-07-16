variable "app_name" {
  description = "Elastic Beanstalk application name (e.g. faborchestratorai)."
  type        = string
}

variable "env_name" {
  description = "Elastic Beanstalk environment name (e.g. faborchestratorai-prod)."
  type        = string
}

variable "description" {
  description = "Human-readable application description."
  type        = string
  default     = ""
}

variable "solution_stack_name" {
  description = "EB platform solution stack (Docker on Amazon Linux 2023)."
  type        = string
  default     = "64bit Amazon Linux 2023 v4.12.1 running Docker"
}

variable "version_label" {
  description = <<-EOT
    Application version to run. Leave null so Terraform does not fight the
    deploy pipeline (which creates timestamped versions and points the env at
    them). Set to a specific label only if Terraform should own deploys too.
  EOT
  type        = string
  default     = null
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "min_size" {
  type    = number
  default = 1
}

variable "max_size" {
  type    = number
  default = 2
}

variable "idle_timeout" {
  description = "ALB idle timeout (seconds). 600 gives SSE streams headroom over the app's 300s maxDuration."
  type        = number
  default     = 600
}

variable "instance_profile" {
  type    = string
  default = "aws-elasticbeanstalk-ec2-role"
}

variable "service_role" {
  type    = string
  default = "aws-elasticbeanstalk-service-role"
}

variable "vpc_id" {
  description = "VPC the environment runs in."
  type        = string
}

variable "instance_subnets" {
  description = "Subnet IDs for the EC2 instances (private subnets when CMF reach is needed)."
  type        = list(string)
}

variable "elb_subnets" {
  description = "Subnet IDs for the ALB (public subnets for an internet-facing app)."
  type        = list(string)
}

variable "elb_scheme" {
  description = "'public' (internet-facing) or 'internal'."
  type        = string
  default     = "public"
}

variable "instance_security_groups" {
  description = <<-EOT
    Extra security groups to attach to the EC2 instances, on top of the one EB
    manages. Use this to grant egress to CMF (SQL + REST) without touching EB's
    own ALB<->instance rules.
  EOT
  type        = list(string)
  default     = []
}

variable "environment_variables" {
  description = "App environment variables (namespace aws:elasticbeanstalk:application:environment)."
  type        = map(string)
  default     = {}
}

variable "extra_settings" {
  description = "Escape hatch for any additional EB option settings."
  type = list(object({
    namespace = string
    name      = string
    value     = string
  }))
  default = []
}

variable "create_build_bucket" {
  description = "Create the S3 bucket that holds deployment bundles."
  type        = bool
  default     = true
}

variable "build_bucket_name" {
  description = "Name of the deployment-bundle S3 bucket."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
