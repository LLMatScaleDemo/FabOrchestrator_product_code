/**
 * Adopt the EXISTING Fab deployment into Terraform state instead of recreating
 * it. Run `terraform plan` after `init` and confirm the plan shows only
 * in-place adjustments (no destroy/create of the environment) before applying.
 *
 * Requires Terraform >= 1.5 (import blocks). Remove these blocks after the
 * first successful apply, or keep them — they are no-ops once imported.
 *
 * The Fab Admin App has NO Elastic Beanstalk resources yet (it runs on App
 * Runner, which AWS is retiring), so there is nothing to import for it —
 * module.admin CREATES a fresh EB environment (fab-admin-prod) and its own
 * deploy bucket.
 */

import {
  to = module.fab.aws_elastic_beanstalk_application.this
  id = "faborchestratorai"
}

import {
  to = module.fab.aws_elastic_beanstalk_environment.this
  id = "e-gdghmvt96r"
}

import {
  to = module.fab.aws_s3_bucket.build[0]
  id = "faborchestratorai-build-628203515088"
}
