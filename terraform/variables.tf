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

variable "fab_use_cmf_vpc" {
  description = <<-EOT
    false (default) = Fab stays in the shared VPC exactly as it runs today (no
    CMF reach; Master Data Load only works from a machine on the VPN).
    true = Fab runs in the new private CMF subnets behind an ALB in the CMF
    public subnets, with egress to CMF and RDS reached over a VPC peer.
    Flipping this MOVES the environment's networking — plan carefully.
  EOT
  type        = bool
  default     = false
}

variable "cmf_app_subnets" {
  description = "New private subnets to create in the CMF VPC for the Fab app (>=2 AZ)."
  type        = map(string)
  default = {
    "us-west-2a" = "10.200.4.0/24"
    "us-west-2b" = "10.200.5.0/24"
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
