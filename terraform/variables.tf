variable "region" {
  type    = string
  default = "us-west-2"
}

# ---- Shared / existing infrastructure (data-source lookups, not created here) ----

variable "shared_vpc_id" {
  description = "Shared VPC that holds RDS + today's Fab EB env."
  type        = string
  default     = "vpc-0521d5dc5d2554e5a"
}

variable "shared_public_subnets" {
  description = "Public subnets in the shared VPC (used by admin ALB, and Fab ALB if it stays put)."
  type        = list(string)
  default = [
    "subnet-06faf688f0ea464ac", # us-west-2a
    "subnet-0e0f6ddda096487f3", # us-west-2b
    "subnet-07a09ab450b741c55", # us-west-2c
  ]
}

variable "cmf_vpc_id" {
  description = "VPC with the Site-to-Site VPN to on-prem CMF."
  type        = string
  default     = "vpc-0bfed5466dbec5bf2"
}

variable "cmf_private_route_table_id" {
  description = "CMF VPC route table with 10.10.1.0/24 -> VGW and 0.0.0.0/0 -> NAT."
  type        = string
  default     = "rtb-09fded11d95955fbd"
}

variable "cmf_public_subnets" {
  description = "Public subnets in the CMF VPC (for the Fab ALB when Fab runs in the CMF VPC)."
  type        = list(string)
  default = [
    "subnet-07e5d47cbc98ae7b6", # us-west-2a
    "subnet-05c2362dd87a7faa9", # us-west-2b
  ]
}

variable "rds_security_group_id" {
  description = "Shared RDS security group."
  type        = string
  default     = "sg-0af6fdeed5a3882f2"
}

# ---- Feature flag: put the Fab app in the CMF VPC so Master Data Load works ----

variable "enable_cmf_networking" {
  description = <<-EOT
    Create the CMF-VPC networking (private subnets, egress SG, RDS peer). This is
    independent of which VPC the Fab env runs in, because an EB environment's VPC
    is IMMUTABLE — moving Fab to the CMF VPC requires a blue/green env + CNAME
    swap, not an in-place change. Keep this on to hold the networking in place.
  EOT
  type        = bool
  default     = false
}

variable "fab_use_cmf_vpc" {
  description = <<-EOT
    Which VPC the Fab env is CONFIGURED for. NOTE: EB will not change an existing
    environment's VPC in place, so leave this false for the live env and use a
    separate blue/green environment in the CMF VPC for Master Data Load.
  EOT
  type        = bool
  default     = false
}

variable "cmf_app_subnets" {
  description = "New private subnets to create in the CMF VPC for the Fab app (>=2 AZ)."
  type        = map(string)
  # CMF VPC is 10.200.0.0/22 (.0-.3 only); .1/.2/.3 are used, so the free
  # 10.200.0.0/24 is split into two /25s for multi-AZ.
  default = {
    "us-west-2a" = "10.200.0.0/25"
    "us-west-2b" = "10.200.0.128/25"
  }
}

# ---- App config (non-secret). Secrets are set out of band — see README. ----

variable "fab_env" {
  description = "Non-secret env vars for the Fab app."
  type        = map(string)
  default = {
    NODE_ENV     = "production"
    HOSTNAME     = "0.0.0.0"
    PORT         = "3000"
    NODE_OPTIONS = "--max-old-space-size=6144"
  }
}

variable "admin_env" {
  description = "Non-secret env vars for the Fab Admin App."
  type        = map(string)
  default = {
    NODE_ENV     = "production"
    HOSTNAME     = "0.0.0.0"
    PORT         = "3000"
    NODE_OPTIONS = "--max-old-space-size=4096"
  }
}

variable "create_admin_env" {
  description = "Create the Fab Admin App EB environment (migrating it off App Runner). Set true when ready to cut over."
  type        = bool
  default     = false
}

variable "create_fab_cmf_env" {
  description = <<-EOT
    Create the blue/green Fab environment (faborchestratorai-cmf) in the CMF VPC.
    Requires enable_cmf_networking = true. After it's healthy and Master Data
    Load works, swap CNAMEs with faborchestratorai-prod.
  EOT
  type        = bool
  default     = false
}
