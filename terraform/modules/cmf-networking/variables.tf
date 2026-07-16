variable "name" {
  description = "Name prefix for resources this module creates."
  type        = string
  default     = "faborch-cmf"
}

variable "cmf_vpc_id" {
  description = "The VPC that already has the Site-to-Site VPN to on-prem CMF (vpc-0bfed…)."
  type        = string
}

variable "cmf_private_route_table_id" {
  description = <<-EOT
    The existing route table in the CMF VPC that routes 10.10.1.0/24 to the VGW
    and 0.0.0.0/0 to the NAT gateway (rtb-09fded…). New app subnets are
    associated with it so they inherit the on-prem + internet paths.
  EOT
  type        = string
}

variable "app_subnets" {
  description = <<-EOT
    Private subnets to create for the app, as { availability_zone = cidr_block }.
    Use >= 2 AZs for HA. CIDRs must be free inside the CMF VPC block (10.200.0.0/22).
  EOT
  type        = map(string)
  # Example: { "us-west-2a" = "10.200.4.0/24", "us-west-2b" = "10.200.5.0/24" }
}

variable "cmf_onprem_cidr" {
  description = "On-prem CIDR reachable over the VPN (CMF SQL + REST live here)."
  type        = string
  default     = "10.10.1.0/24"
}

# ---- Optional: peer the CMF VPC to the shared VPC so the app can reach RDS ----

variable "enable_rds_peering" {
  description = "Create a VPC peering connection so the app (in the CMF VPC) can reach the shared RDS in the app VPC."
  type        = bool
  default     = false
}

variable "shared_vpc_id" {
  description = "The shared VPC that holds RDS (vpc-0521…). Required when enable_rds_peering = true."
  type        = string
  default     = null
}

variable "shared_vpc_cidr" {
  description = "CIDR of the shared VPC, for return routes."
  type        = string
  default     = null
}

variable "shared_route_table_ids" {
  description = "Route tables in the shared VPC that need a return route to the app subnets."
  type        = list(string)
  default     = []
}

variable "rds_security_group_id" {
  description = "RDS security group to open on 5432 from the app subnets (sg-0af6…)."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
