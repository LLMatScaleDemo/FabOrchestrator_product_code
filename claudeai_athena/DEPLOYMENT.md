# FabOrchestrator.ai — Deployment Guide

Complete, current deployment guide for the **Fab app** (`claudeai_athena`) on
**AWS Elastic Beanstalk (Docker)**, including the **CMF VPC** networking that
makes the **Modeling Agent / Master Data Load** reach the on-prem CMF MES.

Infrastructure is defined as code in **`terraform/`** (repo root). Routine app
deploys use the **AWS CLI** flow at the bottom. Read the whole thing once — the
CMF VPC and blue/green cutover are the parts that trip people up.

---

## 1. TL;DR — the two things you'll do most

**Deploy new app code** (no infra change) → [§8 Routine app deploy](#8-routine-app-deploy).

**Change infrastructure** (subnets, env, IAM, a new environment) → edit
`terraform/`, then `plan` + `apply` ([§6 Terraform](#6-infrastructure-as-code-terraform)).

> ⚠️ The Docker image MUST build on **Node 22** (`node:22-alpine`). A dependency
> uses `util.markAsUncloneable` (Node 22+); on Node 20 the on-instance
> `npm run build` fails with `markAsUncloneable is not a function`.

---

## 2. Current production topology

| Item | Value |
|------|-------|
| **Public URL (HTTPS)** | https://d7y8a8whrch88.cloudfront.net (CloudFront front for the Fab app) |
| **Origin URL (EB, HTTP)** | http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com |
| **Serving environment** | `faborchestratorai-cmf` (env id `e-r4vtijxusf`) — runs in the **CMF VPC** |
| **Rollback environment** | `faborchestratorai-prod` (env id `e-gdghmvt96r`) — old env in the shared VPC, parked at the `…-cmf` URL |
| **Region / account** | us-west-2 / 628203515088 |
| **Platform** | 64bit Amazon Linux 2023 running Docker · t3.large · ALB (600s idle) · Nginx:80 → container:3000 |
| **Database** | RDS PostgreSQL `claude_ai_athena` on `athena-poc-db` (shared with the admin app) |

**Why two environments:** an Elastic Beanstalk environment's **VPC is
immutable** — you cannot move a live env into another VPC. To give the Fab app
access to CMF (which lives behind a Site-to-Site VPN in a different VPC), we
stood up a **second env in the CMF VPC** and **swapped CNAMEs** (blue/green).
The production URL now points at the CMF-VPC env; the old env is the rollback.

---

## 3. Network architecture (the important part)

```
                 Users (browser)
                       │  http://faborchestratorai-prod.eba-dk3f4zhh…
                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  CMF VPC  vpc-0bfed5466dbec5bf2   (10.200.0.0/22)          │
        │                                                            │
        │   public subnets (ALB, internet-facing)                    │
        │     subnet-07e5d47cbc98ae7b6 (2a) · subnet-05c2362dd87a7faa9 (2b)
        │              │                                             │
        │              ▼                                             │
        │   private subnets (EB instances)  ← env faborchestratorai-cmf
        │     subnet-0cfc26eb17af33330 (2a, 10.200.0.0/25)           │
        │     subnet-03de8d1716947ddfb (2b, 10.200.0.128/25)         │
        │        route table rtb-09fded11d95955fbd:                  │
        │          10.10.1.0/24 → VGW (vgw-02b836…) ── Site-to-Site VPN → on-prem CMF
        │          0.0.0.0/0    → NAT ── AWS APIs, Anthropic, ECR public
        │          vpc-0521 CIDR → PCX (peering) ── shared RDS       │
        └──────────────────────────────────────────────────────────┘
                       │ VPC peering (pcx) for RDS 5432
                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Shared VPC  vpc-0521d5dc5d2554e5a                         │
        │    RDS  athena-poc-db  (claude_ai_athena)                  │
        │    old env faborchestratorai-prod (rollback)              │
        └──────────────────────────────────────────────────────────┘
```

- **CMF SQL + REST** are reached over the **VGW / Site-to-Site VPN** (route
  `10.10.1.0/24 → VGW`). This VPN is the same one the CMF Lambdas use; it is
  always up (AWS ↔ on-prem), independent of any laptop VPN.
- **RDS** is in the shared VPC, reached over a **VPC peering** connection
  (`allow_remote_vpc_dns_resolution` on, RDS SG opened to the CMF private subnet
  CIDRs on 5432).
- **AWS Secrets Manager** (CMF token), **Anthropic API**, **ECR public** (base
  image) go out via the **NAT gateway**.

VPC peering is **not transitive** — the shared VPC cannot reach on-prem through
the CMF VGW. That's why the Fab app must run *inside* the CMF VPC, not just peer
to it.

---

## 4. AWS resources

| Resource | Identifier | Notes |
|----------|-----------|-------|
| EB application | `faborchestratorai` | one app, two environments |
| EB env (prod, CMF VPC) | `faborchestratorai-cmf` / `e-r4vtijxusf` | serves the prod URL |
| EB env (rollback) | `faborchestratorai-prod` / `e-gdghmvt96r` | old, shared VPC |
| Deploy bucket | `faborchestratorai-build-628203515088` | app bundles |
| CMF VPC | `vpc-0bfed5466dbec5bf2` | Site-to-Site VPN to CMF |
| CMF private subnets | `subnet-0cfc26eb17af33330`, `subnet-03de8d1716947ddfb` | EB instances |
| CMF public subnets | `subnet-07e5d47cbc98ae7b6`, `subnet-05c2362dd87a7faa9` | ALB |
| CMF route table | `rtb-09fded11d95955fbd` | VGW + NAT + peering |
| VGW (VPN) | `vgw-02b836da79f6df84c` / `vpn-022979f12077b8465` | → on-prem 10.10.1.0/24 |
| RDS | `athena-poc-db` (`claude_ai_athena`) | shared VPC `vpc-0521d5dc5d2554e5a` |
| Instance role | `aws-elasticbeanstalk-ec2-role` | + inline policy `cmf-loader-access` |
| Service role | `aws-elasticbeanstalk-service-role` | |
| Terraform state | S3 `faborchestratorai-tfstate-628203515088` + DynamoDB `faborchestratorai-tflock` | |

---

## 5. Environment variables

Set on the **environment** (EB option settings, namespace
`aws:elasticbeanstalk:application:environment`). Secrets live only on the env —
never in git or Terraform state.

### Core app
| Var | Purpose |
|-----|---------|
| `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000` | runtime |
| `NODE_OPTIONS=--max-old-space-size=6144` | Node heap (t3.large = 8 GB) |
| `DATABASE_URL` | RDS `claude_ai_athena` |
| `ANTHROPIC_API_KEY` | server-side Claude key |
| `KEY_ENCRYPTION_SECRET` | AES-256-GCM key (64 hex) |
| `APP_URL`, `SMTP_*` | app / email |

### CMF / Master Data Load (required for the loader to work)
| Var | Value / purpose |
|-----|-----------------|
| `CMF_SQL_SERVER` | `10.10.1.224` (SQL host; also try `10.10.1.134`, what the Lambdas use) |
| `CMF_SQL_INSTANCE` | `ONLINE` (named instance — needs UDP 1434 + dynamic port) |
| `CMF_SQL_DB` | `EntegrisKSPUpgrade` |
| `CMF_SQL_USER`, `CMF_SQL_PASS` | SQL creds |
| `CMF_BASE_URL` | `https://atscmapp4.usa.athenatec.com` |
| `HOST_RESOLVER` | `atscmapp4.usa.athenatec.com=10.10.1.224` (pin REST host to its private IP so it goes over the VPN) |
| `CMF_TLS_INSECURE` | `1` (self-signed CMF cert) |
| `CMF_TOKEN_SECRET_ID` | `cmf/mes-token` (rotating bearer token in Secrets Manager) |
| `CMF_TOKEN_REGION`, `TOKEN_SAFETY_MARGIN_SEC` | `us-west-2`, `60` |
| `S3_BUCKET` | `cmf-loader-uploads-628203515088` (stages generated/uploaded files) |
| `S3_UPLOAD_BUCKET`, `S3_PRESIGN_TTL_SECONDS` | `faborch-user-uploads`, `86400` |

### IAM the instance role needs (inline policy `cmf-loader-access`)
- `s3:GetObject/PutObject/DeleteObject/ListBucket` on the staging buckets.
- `secretsmanager:GetSecretValue` on `cmf/mes-token-*`.

```bash
aws iam put-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name cmf-loader-access --policy-document file://cmf-loader-policy.json
```

### Update env vars
```bash
aws elasticbeanstalk update-environment --environment-name faborchestratorai-cmf \
  --region us-west-2 \
  --option-settings "Namespace=aws:elasticbeanstalk:application:environment,OptionName=CMF_SQL_PASS,Value=…"
```

---

## 6. Infrastructure as code (Terraform)

Everything network/environment is in **`terraform/`** (see `terraform/README.md`).
State is remote (S3 + DynamoDB lock).

**Running Terraform without a local install** (Docker or CI):
```bash
cd terraform
docker run --rm \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION \
  -v "$PWD:/workspace" -w /workspace hashicorp/terraform:1.9 <init|plan|apply>
```
Apply a reviewed plan with a **saved plan file** (`plan -out=p.tfplan` then
`apply p.tfplan`) — safer than `-auto-approve`.

Key flags in `terraform.tfvars`:
- `enable_cmf_networking = true` — the CMF subnets, peering, egress SG.
- `create_admin_env = true` — the Fab Admin App EB env.
- `create_fab_cmf_env = true` — the CMF-VPC Fab env (has an `import` block for
  the env created by CLI during the first cutover).

Modules: `eb-app` (reusable EB application + environment) and `cmf-networking`.

---

## 7. First-time / from-scratch build order

1. **Networking** (Terraform): `enable_cmf_networking = true` → CMF private
   subnets, egress SG, VPC peering to the shared VPC, RDS ingress rules.
2. **DB migration**: apply `admin_athena/prisma/create_cmf_dataloader.sql`
   (additive, idempotent — adds `conversations.agent` + `cmf_*` tables) to
   `claude_ai_athena`.
3. **Env in the CMF VPC**: create an EB env with `VPCId` = CMF VPC, `Subnets` =
   the private CMF subnets, `ELBSubnets` = the CMF public subnets, all env vars
   (§5), and the current app `version-label`.
4. **IAM**: attach `cmf-loader-access` to `aws-elasticbeanstalk-ec2-role`.
5. **Verify**: log in → Modeling Agent → "Build a blank Reason template" should
   resolve from CMF and produce a Download tile (proves SQL + S3 + token).
6. **Cut over**: swap CNAMEs (§9).

---

## 8. Routine app deploy

For a normal code change (no infra change), deploy to the **live** env
(`faborchestratorai-cmf`):

```bash
cd claudeai_athena
BUCKET=faborchestratorai-build-628203515088
VERSION="v$(date +%Y%m%d-%H%M%S)"

# 1. package (exclude heavy/secret paths)
zip -r eb-deploy.zip . \
  -x "node_modules/*" ".next/*" "*.zip" ".env" ".env.local" ".env.*.local" \
     ".claude/*" "iam/*" ".git/*" "ref_docs/*" "scripts/*" "*.log"

# 2. upload + version
aws s3 cp eb-deploy.zip "s3://$BUCKET/eb-deploy.zip" --region us-west-2
aws elasticbeanstalk create-application-version --application-name faborchestratorai \
  --version-label "$VERSION" --source-bundle "S3Bucket=$BUCKET,S3Key=eb-deploy.zip" --region us-west-2

# 3. deploy to the env currently serving prod
aws elasticbeanstalk update-environment --environment-name faborchestratorai-cmf \
  --version-label "$VERSION" --region us-west-2

# 4. watch (Docker build runs on the instance, ~5-7 min)
aws elasticbeanstalk describe-environments --environment-names faborchestratorai-cmf \
  --region us-west-2 --query 'Environments[0].{Status:Status,Health:Health,Version:VersionLabel}'
rm eb-deploy.zip
```

> Which env is live? Whichever holds the `…-prod…` CNAME. Check with
> `describe-environments … --query 'Environments[].{Env:EnvironmentName,CNAME:CNAME}'`.
> Deploy to that one. (Optionally deploy to both, so the rollback env is current.)

---

## 9. Blue/green cutover & rollback (CNAME swap)

To move production between environments (e.g. a new env in a different VPC, or a
risky change you want to stage first):

1. Stand up the **new** env, deploy the same code, set all env vars, confirm
   **Ready/Green** and that the app works (login + Master Data Load).
2. Swap:
   ```bash
   aws elasticbeanstalk swap-environment-cnames \
     --source-environment-name <live-env> \
     --destination-environment-name <new-env> --region us-west-2
   ```
3. Verify the prod URL now serves the new env.

**Rollback** = swap the same two envs back (seconds). Keep the previous env
running until you're confident.

---

## 10. Database

Migrations are **not** run by the deploy. Apply them explicitly to
`claude_ai_athena` before deploying code that needs new schema:

```bash
psql "$DATABASE_URL" -f admin_athena/prisma/create_cmf_dataloader.sql   # additive, idempotent
# or, from the app: DATABASE_URL=… npx prisma db push
```

---

## 11. Monitoring & troubleshooting

```bash
# health + version
aws elasticbeanstalk describe-environments --environment-names faborchestratorai-cmf --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,Version:VersionLabel}'
# recent events (deploy failures show here)
aws elasticbeanstalk describe-events --environment-name faborchestratorai-cmf --region us-west-2 --max-items 20
# instance logs (Docker build output → eb-engine.log)
aws elasticbeanstalk request-environment-info --environment-name faborchestratorai-cmf --info-type tail --region us-west-2
sleep 10
aws elasticbeanstalk retrieve-environment-info --environment-name faborchestratorai-cmf --info-type tail --region us-west-2 \
  --query 'EnvironmentInfo[0].Message' --output text   # → download the URL
```

| Symptom | Cause / fix |
|---------|-------------|
| Build: `markAsUncloneable is not a function` | Dockerfile on Node 20 → use `node:22-alpine`. |
| `502 Bad Gateway` | `process:default` Port must be **80** (Nginx), not 3000. |
| Health Red after deploy, old version running | Docker build failed → check `eb-engine.log`; EB rolled back. |
| Chat: `CMF SQL not configured` | CMF_SQL_* env vars missing on this env. |
| Loader: `S3_BUCKET is not configured` | `S3_BUCKET` missing, or instance role lacks S3 access. |
| Loader: token / AccessDenied | instance role missing `secretsmanager:GetSecretValue` on `cmf/mes-token`. |
| RDS unreachable from CMF-VPC env | VPC peering route / RDS SG ingress / DNS-over-peering. |

### Known issues
- **Instance root disk fills up** from repeated on-instance Docker builds (seen
  at 93%). Add a `docker system prune -af` platform hook or grow the volume.
- **Full-template sample files** (the 735 KB KSP files) trip a CMF-side
  `Unk10000 — Sequence contains no matching element` on register; the lean
  single-object files register/validate cleanly.

---

## 12. Legacy: App Runner (decommissioned)

The Fab app previously ran on AWS App Runner (120s hard request timeout that
broke SSE streaming). Replaced by Elastic Beanstalk. The old App Runner service
can be deleted.
