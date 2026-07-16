# CMF networking exists (subnets, peering, egress SG, RDS ingress). Keep it on.
enable_cmf_networking = true

# EB will not move a live environment's VPC in place, so the current Fab env
# stays in the shared VPC. Master Data Load reachability is handled by a separate
# blue/green Fab env in the CMF VPC (see README "Fab CMF cutover").
fab_use_cmf_vpc = false

# Fab Admin App EB env (replaces App Runner).
create_admin_env = true

# Blue/green Fab env in the CMF VPC (Master Data Load). Swap CNAMEs after verify.
create_fab_cmf_env = true

# The one free /24 in the CMF VPC (10.200.0.0/22) split into two /25s.
cmf_app_subnets = {
  "us-west-2a" = "10.200.0.0/25"
  "us-west-2b" = "10.200.0.128/25"
}
