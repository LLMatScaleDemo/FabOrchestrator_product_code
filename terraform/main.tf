/**
 * Root composition for FabOrchestrator + Admin on Elastic Beanstalk.
 *
 *  - cmf_networking (optional): private subnets + egress SG in the CMF VPC so
 *    the Fab app can reach on-prem CMF. Only built when fab_use_cmf_vpc = true.
 *  - fab: the FabOrchestrator EB app/env (adopted from the existing deployment).
 *  - admin: the Fab Admin App EB app/env, created to standardise it onto the
 *    same platform as Fab (replacing App Runner, which AWS is retiring). Gated
 *    by create_admin_env.
 *
 * Secrets (DATABASE_URL, ANTHROPIC_API_KEY, KEY_ENCRYPTION_SECRET, CMF_* creds)
 * are NOT in this code — see README "Secrets".
 */

module "cmf_networking" {
  source = "./modules/cmf-networking"
  count  = var.enable_cmf_networking ? 1 : 0

  name                       = "faborch-cmf"
  cmf_vpc_id                 = var.cmf_vpc_id
  cmf_private_route_table_id = var.cmf_private_route_table_id
  app_subnets                = var.cmf_app_subnets

  # Reach the shared RDS from the CMF VPC over a peer.
  enable_rds_peering    = true
  shared_vpc_id         = var.shared_vpc_id
  shared_vpc_cidr       = data.aws_vpc.shared.cidr_block
  shared_route_table_ids = data.aws_route_tables.shared.ids
  rds_security_group_id = var.rds_security_group_id
}

locals {
  fab_vpc_id           = var.fab_use_cmf_vpc ? var.cmf_vpc_id : var.shared_vpc_id
  fab_instance_subnets = var.fab_use_cmf_vpc ? module.cmf_networking[0].app_subnet_ids : var.shared_public_subnets
  fab_elb_subnets      = var.fab_use_cmf_vpc ? var.cmf_public_subnets : var.shared_public_subnets
  fab_instance_sgs     = var.fab_use_cmf_vpc ? [module.cmf_networking[0].app_security_group_id] : []
}

module "fab" {
  source = "./modules/eb-app"

  app_name            = "faborchestratorai"
  env_name            = "faborchestratorai-prod"
  description         = "FabOrchestrator.ai - AI Chat Application"
  solution_stack_name = "64bit Amazon Linux 2023 v4.12.0 running Docker"
  build_bucket_name   = "faborchestratorai-build-628203515088"
  create_build_bucket = true

  instance_type = "t3.large"
  min_size      = 1
  max_size      = 2
  idle_timeout  = 600

  vpc_id                   = local.fab_vpc_id
  instance_subnets         = local.fab_instance_subnets
  elb_subnets              = local.fab_elb_subnets
  instance_security_groups = local.fab_instance_sgs

  environment_variables = var.fab_env
}

# Blue/green: a second Fab environment in the CMF VPC (for Master Data Load).
# Reuses the existing "faborchestratorai" application and build bucket; runs in
# the CMF private subnets with the egress SG. After it's verified healthy and
# Master Data Load works, swap CNAMEs with faborchestratorai-prod.
module "fab_cmf" {
  source = "./modules/eb-app"
  count  = var.create_fab_cmf_env ? 1 : 0

  app_name            = "faborchestratorai"
  create_application  = false # reuse the existing application
  env_name            = "faborchestratorai-cmf"
  description         = "FabOrchestrator.ai - CMF VPC (Master Data Load)"
  solution_stack_name = "64bit Amazon Linux 2023 v4.12.0 running Docker"
  create_build_bucket = false # reuse faborchestratorai-build-…

  instance_type = "t3.large"
  min_size      = 1
  max_size      = 2
  idle_timeout  = 600

  vpc_id                   = var.cmf_vpc_id
  instance_subnets         = module.cmf_networking[0].app_subnet_ids
  elb_subnets              = var.cmf_public_subnets
  instance_security_groups = [module.cmf_networking[0].app_security_group_id]

  environment_variables = var.fab_env
}

module "admin" {
  source = "./modules/eb-app"
  count  = var.create_admin_env ? 1 : 0

  app_name            = "fab-admin"
  env_name            = "fab-admin-prod"
  description         = "Fab Admin App - admin console"
  solution_stack_name = "64bit Amazon Linux 2023 v4.12.1 running Docker"
  build_bucket_name   = "fab-admin-build-628203515088"
  create_build_bucket = true # fresh bucket for the EB deploys (App Runner/CodeBuild is retired)

  instance_type = "t3.medium"
  min_size      = 1
  max_size      = 2
  idle_timeout  = 600

  # Admin needs no CMF reach — shared VPC, public subnets.
  vpc_id           = var.shared_vpc_id
  instance_subnets = var.shared_public_subnets
  elb_subnets      = var.shared_public_subnets

  environment_variables = var.admin_env
}
