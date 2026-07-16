/**
 * eb-app — a reusable Elastic Beanstalk (Docker) web application.
 *
 * Encapsulates the exact shape both FabOrchestrator and the Admin app deploy
 * with: a load-balanced Docker environment behind an ALB (600s idle timeout,
 * sticky sessions), Nginx on port 80 proxying to the container on 3000, and
 * enhanced health. App VERSIONS are created by the deploy pipeline, not here —
 * this module owns the application, the environment, its config, and (optional)
 * the deployment-bundle bucket.
 */

locals {
  base_settings = [
    { namespace = "aws:autoscaling:launchconfiguration", name = "InstanceType", value = var.instance_type },
    { namespace = "aws:autoscaling:launchconfiguration", name = "IamInstanceProfile", value = var.instance_profile },
    { namespace = "aws:elasticbeanstalk:environment", name = "EnvironmentType", value = "LoadBalanced" },
    { namespace = "aws:elasticbeanstalk:environment", name = "LoadBalancerType", value = "application" },
    { namespace = "aws:elasticbeanstalk:environment", name = "ServiceRole", value = var.service_role },
    { namespace = "aws:autoscaling:asg", name = "MinSize", value = tostring(var.min_size) },
    { namespace = "aws:autoscaling:asg", name = "MaxSize", value = tostring(var.max_size) },
    { namespace = "aws:elbv2:loadbalancer", name = "IdleTimeout", value = tostring(var.idle_timeout) },
    { namespace = "aws:ec2:vpc", name = "VPCId", value = var.vpc_id },
    { namespace = "aws:ec2:vpc", name = "Subnets", value = join(",", var.instance_subnets) },
    { namespace = "aws:ec2:vpc", name = "ELBSubnets", value = join(",", var.elb_subnets) },
    { namespace = "aws:ec2:vpc", name = "ELBScheme", value = var.elb_scheme == "internal" ? "internal" : "public" },
    { namespace = "aws:elasticbeanstalk:healthreporting:system", name = "SystemType", value = "enhanced" },
    # Nginx on 80 is the ALB target; it reverse-proxies to the container on 3000.
    # Setting this to 3000 causes 502s — see DEPLOYMENT.md.
    { namespace = "aws:elasticbeanstalk:environment:process:default", name = "Port", value = "80" },
    { namespace = "aws:elasticbeanstalk:environment:process:default", name = "Protocol", value = "HTTP" },
    { namespace = "aws:elasticbeanstalk:environment:process:default", name = "StickinessEnabled", value = "true" },
    { namespace = "aws:elasticbeanstalk:environment:process:default", name = "StickinessLBCookieDuration", value = "600" },
  ]

  sg_settings = length(var.instance_security_groups) > 0 ? [
    { namespace = "aws:autoscaling:launchconfiguration", name = "SecurityGroups", value = join(",", var.instance_security_groups) },
  ] : []

  env_settings = [
    for k, v in var.environment_variables :
    { namespace = "aws:elasticbeanstalk:application:environment", name = k, value = v }
  ]

  all_settings = concat(local.base_settings, local.sg_settings, local.env_settings, var.extra_settings)
}

resource "aws_elastic_beanstalk_application" "this" {
  count       = var.create_application ? 1 : 0
  name        = var.app_name
  description = var.description
  tags        = var.tags
}

locals {
  application_name = var.create_application ? aws_elastic_beanstalk_application.this[0].name : var.app_name
}

# The application resource gained a count; relocate the already-managed instance
# (fab, admin) instead of destroy/recreate. Ignored for instances with no prior
# state (a new blue env that reuses an existing application).
moved {
  from = aws_elastic_beanstalk_application.this
  to   = aws_elastic_beanstalk_application.this[0]
}

resource "aws_s3_bucket" "build" {
  count  = var.create_build_bucket ? 1 : 0
  bucket = coalesce(var.build_bucket_name, "${var.app_name}-build")
  tags   = var.tags
}

resource "aws_elastic_beanstalk_environment" "this" {
  name                = var.env_name
  application         = local.application_name
  solution_stack_name = var.solution_stack_name
  tier                = "WebServer"
  version_label       = var.version_label
  tags                = var.tags

  dynamic "setting" {
    for_each = local.all_settings
    content {
      namespace = setting.value.namespace
      name      = setting.value.name
      value     = setting.value.value
    }
  }

  # The deploy pipeline pushes new application versions and rolls them out; do
  # not let a Terraform run revert the environment to an older version_label.
  lifecycle {
    ignore_changes = [version_label]
  }
}
