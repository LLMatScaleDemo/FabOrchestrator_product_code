# Terraform — FabOrchestrator + Fab Admin App deployment

Infrastructure-as-code for both apps on **AWS Elastic Beanstalk (Docker)**, plus
the networking that lets the Fab app reach on-prem **CMF** for Master Data Load.

This replaces the hand-run AWS CLI scripts previously documented in each app's
`DEPLOYMENT.md`. It also migrates the **Fab Admin App** off **App Runner** (which
AWS is retiring) onto the same Elastic Beanstalk platform as Fab.

```
terraform/
├── versions.tf / providers.tf / backend.tf   # provider, ~>5.60 AWS, S3 remote state
├── variables.tf / data.tf / main.tf           # root: composes the modules
├── imports.tf                                 # adopt the existing Fab EB env into state
├── outputs.tf / terraform.tfvars.example
└── modules/
    ├── eb-app/          # reusable EB application + environment (both apps use it)
    └── cmf-networking/  # private subnets + egress SG (+ optional RDS peer) in the CMF VPC
```

## What it manages

| Resource | Fab | Admin |
|----------|-----|-------|
| EB application + environment | adopted (imported) | **created** (replaces App Runner) |
| Deployment-bundle S3 bucket | managed | created (`fab-admin-build-…`) |
| CMF private subnets + egress SG | when `fab_use_cmf_vpc = true` | n/a (Fab Admin App needs no CMF) |
| VPC peer to shared RDS | with the CMF networking | n/a |

App **deploys** (new versions) still go through the pipeline in each
`DEPLOYMENT.md` (zip → S3 → `create-application-version` → `update-environment`)
or CI — Terraform owns the *environment*, not each code push (`version_label` is
in `ignore_changes`).

## Prerequisites

- Terraform >= 1.6, AWS CLI authenticated to account `628203515088` (us-west-2).
- Remote-state bucket + lock table (one-time bootstrap commands are in `backend.tf`).

## Rollout (three safe phases)

Everything is behind flags so you adopt first and change behaviour later.

### Phase 1 — adopt the current deployment (no behaviour change)

```hcl
# terraform.tfvars
fab_use_cmf_vpc  = false
create_admin_env = false
```

```bash
terraform init
terraform plan     # MUST show the Fab app/env/bucket as imports + only in-place tweaks
terraform apply
```

The `import` blocks in `imports.tf` pull the live Fab environment into state.
Review the plan carefully: it should **not** propose destroying/recreating
`faborchestratorai-prod`. Small in-place setting diffs are normal (Terraform
writes the option settings explicitly); if any diff looks wrong, align the
module default to the live value in `main.tf` before applying.

### Phase 2 — give Fab CMF reachability (Master Data Load)

```hcl
fab_use_cmf_vpc = true
```

This builds two private subnets in the CMF VPC (`vpc-0bfed…`) on the VGW+NAT
route table, an egress security group (CMF SQL named-instance + REST + AWS
services), and a VPC peer to the shared VPC so the app still reaches RDS. Then it
**moves the Fab environment's networking** into those subnets with an ALB in the
CMF public subnets.

> Moving an environment's VPC/subnets is disruptive — Terraform may replace the
> environment. Do it in a maintenance window, and set the Fab app's
> `CMF_SQL_SERVER=10.10.1.134`, `HOST_RESOLVER=atscmapp4.usa.athenatec.com=10.10.1.224`,
> and the other CMF env vars (see below) first.

### Phase 3 — migrate the Fab Admin App off App Runner onto EB

```hcl
create_admin_env = true
```

Creates `fab-admin-prod` on Elastic Beanstalk using the same module. Confirm the
Fab Admin App repo has the EB scaffolding Fab has (`Dockerfile`, `.ebextensions/`,
`.platform/nginx/proxy.conf`), deploy a version, verify, then decommission the
old App Runner service.

## Secrets — not in this code

Terraform sets only **non-secret** env (`fab_env` / `admin_env`). Set secrets on
the environment out of band so they never land in state or VCS:

```bash
aws elasticbeanstalk update-environment --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value=…" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ANTHROPIC_API_KEY,Value=…" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=KEY_ENCRYPTION_SECRET,Value=…" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_SQL_SERVER,Value=10.10.1.134" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_SQL_INSTANCE,Value=ONLINE" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_SQL_USER,Value=…" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_SQL_PASS,Value=…" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_BASE_URL,Value=https://atscmapp4.usa.athenatec.com" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=HOST_RESOLVER,Value=atscmapp4.usa.athenatec.com=10.10.1.224" \
  --region us-west-2
```

Set to `ignore_changes` on env vars is intentionally NOT used, so keep
Terraform-managed (non-secret) keys and out-of-band (secret) keys disjoint —
otherwise a Terraform apply and the CLI will fight over the same env block.
(If you prefer, move secrets to AWS Secrets Manager and read them at runtime, as
the CMF token already is.)

## Reconcile: resources created out-of-band (AWS CLI)

Because Docker/Terraform were unavailable during the CMF cutover, a few things
were done with the AWS CLI and are **not yet in Terraform state**. Reconcile on
the next `terraform apply` (the config + `imports.tf` are already set up for it):

- **Blue Fab env `faborchestratorai-cmf`** (`e-r4vtijxusf`) — has an `import`
  block; a plan will adopt it. After the **CNAME swap** it serves the production
  URL, and the old `faborchestratorai-prod` env is the rollback.
- **IAM inline policy `cmf-loader-access`** on `aws-elasticbeanstalk-ec2-role`
  (S3 staging buckets + `secretsmanager:GetSecretValue` on `cmf/mes-token`) —
  not modelled in TF; add an `aws_iam_role_policy` resource if you want it managed.
- **CMF/S3 env vars** on the blue env (`CMF_SQL_*`, `S3_BUCKET`, …) were set via
  the CLI (secrets stay out of state on purpose).

## Why the Fab app must live in the CMF VPC (not just peer to it)

VPC peering is **not transitive**: peering the shared VPC to the CMF VPC would
not let it reach on-prem `10.10.1.0/24` through the CMF VPN gateway. So the app
has to run *inside* the CMF VPC's subnets (which this module creates). RDS, being
an ordinary VPC resource, IS reachable across a peer — hence the optional peer.
