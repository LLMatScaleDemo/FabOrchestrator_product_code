output "app_subnet_ids" {
  description = "Private app subnets in the CMF VPC (feed these to the eb-app instance_subnets)."
  value       = [for s in aws_subnet.app : s.id]
}

output "app_subnet_ids_by_az" {
  value = { for az, s in aws_subnet.app : az => s.id }
}

output "app_security_group_id" {
  description = "Egress SG to attach to the EB instances (eb-app instance_security_groups)."
  value       = aws_security_group.app.id
}

output "peering_connection_id" {
  value = var.enable_rds_peering ? aws_vpc_peering_connection.rds[0].id : null
}
