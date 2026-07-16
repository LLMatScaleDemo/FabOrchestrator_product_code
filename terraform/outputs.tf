output "fab_url" {
  description = "FabOrchestrator environment CNAME."
  value       = module.fab.cname
}

output "fab_environment_id" {
  value = module.fab.environment_id
}

output "admin_url" {
  description = "Fab Admin App environment CNAME (null until create_admin_env = true)."
  value       = var.create_admin_env ? module.admin[0].cname : null
}

output "cmf_app_subnets" {
  description = "Private CMF subnets created for the Fab app (null unless fab_use_cmf_vpc = true)."
  value       = var.fab_use_cmf_vpc ? module.cmf_networking[0].app_subnet_ids : null
}

output "cmf_app_security_group" {
  value = var.fab_use_cmf_vpc ? module.cmf_networking[0].app_security_group_id : null
}
