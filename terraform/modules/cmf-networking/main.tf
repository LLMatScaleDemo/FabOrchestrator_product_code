/**
 * cmf-networking — makes the Fab app able to reach on-prem CMF.
 *
 * The working reference is the CMF Lambdas: they sit in vpc-0bfed…, in a
 * private subnet whose route table sends 10.10.1.0/24 to a Virtual Private
 * Gateway (Site-to-Site VPN) and 0.0.0.0/0 to a NAT gateway. This module
 * reproduces that for the app tier:
 *
 *   1. Creates >= 2 private subnets (multi-AZ) inside the CMF VPC and attaches
 *      them to that same route table, so they inherit the VPN + NAT paths.
 *   2. Creates an egress-only security group to attach to the EB instances —
 *      it opens traffic to the on-prem CMF range (SQL named instance: SQL
 *      Browser UDP 1434 + dynamic TCP port, plus REST 443) and to AWS services
 *      (Secrets Manager for the token, the Anthropic API) via NAT.
 *   3. Optionally peers the CMF VPC with the shared VPC so the app can reach
 *      the shared RDS (5432), with DNS resolution across the peer.
 *
 * VPC peering is NOT transitive: peering the shared VPC to the CMF VPC does NOT
 * let the shared VPC reach on-prem through the CMF VGW. That is why the app
 * itself must live in the CMF VPC (this module's subnets), not merely peer to it.
 */

data "aws_vpc" "cmf" {
  id = var.cmf_vpc_id
}

# 1) Private app subnets in the CMF VPC, on the VGW+NAT route table.
resource "aws_subnet" "app" {
  for_each                = var.app_subnets
  vpc_id                  = var.cmf_vpc_id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false
  tags                    = merge(var.tags, { Name = "${var.name}-app-${each.key}" })
}

resource "aws_route_table_association" "app" {
  for_each       = aws_subnet.app
  subnet_id      = each.value.id
  route_table_id = var.cmf_private_route_table_id
}

# 2) Egress-only SG for the app instances (EB keeps its own SG for ALB ingress).
resource "aws_security_group" "app" {
  name        = "${var.name}-app-egress"
  description = "Fab app egress to on-prem CMF (SQL + REST) and AWS services"
  vpc_id      = var.cmf_vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-app-egress" })
}

# CMF SQL Server — named instance: SQL Browser (UDP 1434) + the dynamic TCP port.
resource "aws_vpc_security_group_egress_rule" "cmf_sql_browser" {
  security_group_id = aws_security_group.app.id
  description       = "CMF SQL Browser (named-instance discovery)"
  cidr_ipv4         = var.cmf_onprem_cidr
  ip_protocol       = "udp"
  from_port         = 1434
  to_port           = 1434
}

resource "aws_vpc_security_group_egress_rule" "cmf_sql_tcp" {
  security_group_id = aws_security_group.app.id
  description       = "CMF SQL Server (1433 + dynamic instance port)"
  cidr_ipv4         = var.cmf_onprem_cidr
  ip_protocol       = "tcp"
  from_port         = 1024
  to_port           = 65535
}

# CMF REST API over the VPN (HOST_RESOLVER pins the hostname to a private IP).
resource "aws_vpc_security_group_egress_rule" "cmf_rest" {
  security_group_id = aws_security_group.app.id
  description       = "CMF REST API (HTTPS) over the VPN"
  cidr_ipv4         = var.cmf_onprem_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# AWS services via NAT: Secrets Manager (CMF token) + Anthropic API.
resource "aws_vpc_security_group_egress_rule" "aws_https" {
  security_group_id = aws_security_group.app.id
  description       = "AWS services + Anthropic API (HTTPS via NAT)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# 3) Optional: peer to the shared VPC for RDS (5432).
resource "aws_vpc_peering_connection" "rds" {
  count       = var.enable_rds_peering ? 1 : 0
  vpc_id      = var.cmf_vpc_id
  peer_vpc_id = var.shared_vpc_id
  auto_accept = true

  requester {
    allow_remote_vpc_dns_resolution = true
  }
  accepter {
    allow_remote_vpc_dns_resolution = true
  }
  tags = merge(var.tags, { Name = "${var.name}-to-shared-rds" })
}

# App subnets -> shared VPC (RDS) via the peer.
resource "aws_route" "app_to_shared" {
  count                     = var.enable_rds_peering ? 1 : 0
  route_table_id            = var.cmf_private_route_table_id
  destination_cidr_block    = var.shared_vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.rds[0].id
}

# Shared VPC route tables -> app subnets (return path).
resource "aws_route" "shared_to_app" {
  for_each                  = var.enable_rds_peering ? toset(var.shared_route_table_ids) : toset([])
  route_table_id            = each.value
  destination_cidr_block    = data.aws_vpc.cmf.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.rds[0].id
}

# Let the app subnets into the RDS security group on 5432.
resource "aws_vpc_security_group_ingress_rule" "rds_from_app" {
  for_each          = var.enable_rds_peering && var.rds_security_group_id != null ? var.app_subnets : {}
  security_group_id = var.rds_security_group_id
  description       = "Fab app (CMF VPC ${each.key}) to RDS PostgreSQL"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
}
