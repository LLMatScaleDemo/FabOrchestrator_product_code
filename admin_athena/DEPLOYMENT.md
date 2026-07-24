# Fab Admin App — Deployment Guide

Deployment guide for the **Fab Admin App** (`admin_athena`) on **AWS Elastic
Beanstalk (Docker)**. This app **replaced its old AWS App Runner deployment**
(App Runner is being retired) and now runs on the same EB platform as the Fab
app, sharing the same RDS database.

For the overall infrastructure (VPCs, Terraform, state) see the Fab guide
`claudeai_athena/DEPLOYMENT.md` and `terraform/README.md`. This file is the
admin-specific flow.

---

## 1. Current deployment

| Item | Value |
|------|-------|
| **Public URL (HTTPS)** | **https://d1bruj0c9svh90.cloudfront.net** (CloudFront — use this) |
| **Origin URL (EB, HTTP)** | http://fab-admin-prod.eba-h6wfcmim.us-west-2.elasticbeanstalk.com |
| **CloudFront distribution** | `E3DEL8WM533ECX` |
| **EB application** | `fab-admin` |
| **EB environment** | `fab-admin-prod` |
| **Region / account** | us-west-2 / 628203515088 |
| **Platform** | 64bit Amazon Linux 2023 running Docker · t3.medium · ALB (600s idle) |
| **Container port** | **3001** (Nginx:80 → container:3001) — NOT 3000 |
| **Deploy bucket** | `fab-admin-build-628203515088` |
| **VPC** | shared VPC `vpc-0521d5dc5d2554e5a` (no CMF access needed — admin reads the DB only) |
| **Database** | RDS PostgreSQL `claude_ai_athena` on `athena-poc-db` (**shared with the Fab app**) |

> ⚠️ **PORT = 3001.** The admin Dockerfile does `EXPOSE 3001` and the server
> listens on `PORT`. EB's Nginx proxies to 3001, so the `PORT` env var **must be
> 3001** or you get `502 Bad Gateway`. (The Fab app uses 3000 — do not copy that
> value here.)

> ⚠️ Docker image builds on **`node:22-alpine`** (already set in the admin
> Dockerfile). Keep it — a dependency needs Node 22's `util.markAsUncloneable`.

---

## 2. Why EB (and not App Runner)

The admin app previously ran on **App Runner + CodeBuild + ECR** (`nexusops-ai`).
AWS is retiring App Runner, so it was migrated to Elastic Beanstalk to match the
Fab app. The admin app needs **no CMF/VPN access** — it only reads the shared
Postgres tables (including the `cmf_*` loader tables and `audit_logs`), so it
stays in the ordinary shared VPC. The old App Runner service (`nexusops-ai`) can
be deleted once this is confirmed working.

---

## 3. Environment variables

Set on the environment (namespace `aws:elasticbeanstalk:application:environment`).
These were carried over from the App Runner service; secrets live only on the env.

| Var | Purpose |
|-----|---------|
| `NODE_ENV=production`, `HOSTNAME=0.0.0.0` | runtime |
| **`PORT=3001`** | container port (matches Dockerfile `EXPOSE 3001`) |
| `NODE_OPTIONS=--max-old-space-size=4096` | Node heap (t3.medium) |
| `DATABASE_URL` | RDS `claude_ai_athena` (same DB as Fab) |
| `ANTHROPIC_API_KEY` | admin-chat tools |
| `KEY_ENCRYPTION_SECRET` | AES-256-GCM key — **must equal the FO key** (shared DB; see §3b) |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | seed/admin account |
| `APP_URL`, `ATHENA_URL`, `NEXT_PUBLIC_ATHENA_URL` | app + link back to Fab |
| `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | invite emails |
| `MCP_OTF_*` (9 vars) | **On-the-Fly MCP** — see **§3b** for the full list + IAM requirements |

```bash
aws elasticbeanstalk update-environment --environment-name fab-admin-prod --region us-west-2 \
  --option-settings "Namespace=aws:elasticbeanstalk:application:environment,OptionName=<KEY>,Value=<VALUE>"
```

The RDS security group must allow the admin instance SG on 5432 (same shared VPC,
so no peering needed — unlike the Fab CMF env).

---

## 3a. HTTPS via CloudFront

The EB environment only serves **HTTP** on its `…elasticbeanstalk.com` URL. To
get a **secure (HTTPS) URL without a custom domain**, a CloudFront distribution
fronts it:

| | |
|---|---|
| **Distribution** | `E3DEL8WM533ECX` |
| **HTTPS URL** | `https://d1bruj0c9svh90.cloudfront.net` |
| **Origin** | `fab-admin-prod.eba-h6wfcmim…` (HTTP-only, port 80) |
| **Viewer protocol** | `redirect-to-https` (HTTP is 301'd to HTTPS) |
| **Cache policy** | `CachingDisabled` (dynamic app) |
| **Origin request policy** | `AllViewer` (forwards cookies, auth headers, query strings, Host) |
| **TLS cert** | the default `*.cloudfront.net` cert (valid, free) |

`APP_URL` is set to the CloudFront URL so invite emails / self-links use HTTPS.

Recreate / update the distribution:
```bash
# create (config in scripts or inline)
aws cloudfront create-distribution --distribution-config file://admin-cloudfront.json
# after changing config: get ETag, then update-distribution --if-match <ETag>
aws cloudfront get-distribution-config --id E3DEL8WM533ECX
# invalidate cache (rarely needed — caching is disabled)
aws cloudfront create-invalidation --distribution-id E3DEL8WM533ECX --paths "/*"
```

> **SSE caveat (OTF codegen ~80s):** CloudFront's origin read timeout is **60s**,
> and you **cannot raise it past 60 on this account** without an AWS *Service
> Quotas* increase for "Origin response timeout" (61–180 is rejected). The OTF
> "prepare the tools" step is a single ~80s Opus call that emits no bytes while it
> runs, so it would otherwise be cut at 60s. **This is solved IN CODE** by an SSE
> **keepalive** (`withKeepAlive()` in `app/api/admin/chat/route.ts`, emits
> `: keepalive` every 20s) that ships with the normal deploy — **no CloudFront
> change is required.** Do not attempt to raise the timeout.
>
> **Custom domain (optional):** add an `Aliases` (CNAME) + an ACM cert in
> **us-east-1** to the distribution, then point DNS at the CloudFront domain.

---

## 3b. On-the-Fly (OTF) MCP data sources — env vars + IAM (must be present)

The admin app hosts the **On-the-Fly MCP** pipeline: creds intake → discover → codegen
→ **deploy a per-source Lambda MCP server** → register/assign. The admin app runs in the
**shared VPC** but **deploys per-source runtimes INTO the CMF VPC** (SQL Server / on-prem
targets) and invokes the discovery/runtime Lambdas via the AWS Lambda API — so it needs
no CMF network of its own, only the config values + IAM below. The AWS substrate
(artifact bucket, `mcp-otf-runtime-exec` role, runtime SG, discovery Lambda, runtime base
zips, `mcp_data_sources` table) is already provisioned — see `OTF_MCP_DEPLOYMENT_PLAN.md`
and the repo-root `ledger.md`.

**`MCP_OTF_*` env vars on `fab-admin-prod`** (set the same way as §3):
| Var | Value |
|-----|-------|
| `MCP_OTF_RUNTIME_ROLE_ARN` | `arn:aws:iam::628203515088:role/mcp-otf-runtime-exec` **(mandatory — no code default; deploy throws without it)** |
| `MCP_OTF_ARTIFACT_BUCKET` | `mcp-otf-artifacts-628203515088` |
| `MCP_OTF_DISCOVERY_FUNCTION` | `mcp-otf-discovery` |
| `MCP_OTF_RUNTIME_VERSION` | `v1` |
| `MCP_OTF_CMF_SUBNET_IDS` | `subnet-0cfc26eb17af33330,subnet-03de8d1716947ddfb` (CMF VPC — SQL Server targets) |
| `MCP_OTF_CMF_SECURITY_GROUP_ID` | `sg-0dc3bdccf1d97f2c3` |
| `MCP_OTF_SUBNET_IDS` | `subnet-06faf688f0ea464ac,subnet-0e0f6ddda096487f3,subnet-07a09ab450b741c55` (shared VPC — future Postgres targets) |
| `MCP_OTF_SECURITY_GROUP_ID` | `sg-01a539eefc2678e13` |
| `MCP_OTF_CODEGEN_MODEL` | `claude-opus-4-8` (optional; code default) |

Codegen tuning vars (`MCP_OTF_MAX_TOOLS=12`, `MCP_OTF_CODEGEN_MAX_TABLES=100`,
`MCP_OTF_CODEGEN_MAX_TOKENS=20000`, `MCP_OTF_CODEGEN_MAX_COLS=250`) have safe code
defaults — set only to override.

> **`KEY_ENCRYPTION_SECRET` must equal the FO key.** Admin and FO share one DB and both
> read/write AES-256-GCM ciphertext (incl. the per-source OTF bearer tokens). Prod was
> converged onto the **FO key** (`5a83ed…`); `fab-admin-prod` must use that same value or
> it can't decrypt the migrated rows. See `ledger.md` UPDATE 9 (blast radius + the
> `reencrypt-encryption-key.mjs` convergence migration — run it BEFORE changing keys).

**IAM — the `mcp-otf-admin-deploy` managed policy on `aws-elasticbeanstalk-ec2-role`
MUST include the EC2 describe actions.** Because OTF runtimes are **VPC-connected**
Lambdas (CMF VPC), AWS requires the *caller* (the EB instance role) to hold
`ec2:DescribeSubnets`, `ec2:DescribeSecurityGroups`, and `ec2:DescribeVpcs` in addition
to `lambda:CreateFunction` + `iam:PassRole` on the runtime role. The original policy
(v1) lacked these three → the deploy step failed with a generic "infrastructure
permissions issue" in prod (it worked in local dev only because that used the broader
`OTF_MCP` IAM *user*). **Fixed in policy version v2** (2026-07-24). Verify:
```bash
aws iam get-policy-version --policy-arn arn:aws:iam::628203515088:policy/mcp-otf-admin-deploy \
  --version-id $(aws iam get-policy --policy-arn arn:aws:iam::628203515088:policy/mcp-otf-admin-deploy \
  --query 'Policy.DefaultVersionId' --output text) --query 'PolicyVersion.Document' --output json | grep -i describe
```
> ⚠️ **IaC drift:** the v2 change was applied via `create-policy-version` on the live
> policy; `cloudformation/mcp-onthefly.yaml`'s inline `mcp-otf-admin-deploy` still lacks
> the `ec2:Describe*` statement. Add it there before any substrate rebuild, or the deploy
> permission regresses.

## 4. Deploy new code

```bash
cd admin_athena
BUCKET=fab-admin-build-628203515088
VERSION="v$(date +%Y%m%d-%H%M%S)-admin"

zip -r eb-deploy.zip . \
  -x "node_modules/*" ".next/*" "*.zip" ".env" ".env.local" ".env.*.local" \
     ".claude/*" "iam/*" ".git/*" "ref_docs/*" "scripts/*" "*.log" \
     "docs/*" "sample-cmf-inputs/*" ".playwright-mcp/*"

aws s3 cp eb-deploy.zip "s3://$BUCKET/eb-deploy.zip" --region us-west-2
aws elasticbeanstalk create-application-version --application-name fab-admin \
  --version-label "$VERSION" --source-bundle "S3Bucket=$BUCKET,S3Key=eb-deploy.zip" --region us-west-2
aws elasticbeanstalk update-environment --environment-name fab-admin-prod \
  --version-label "$VERSION" --region us-west-2

aws elasticbeanstalk describe-environments --environment-names fab-admin-prod --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,Version:VersionLabel}'
rm eb-deploy.zip
```

The Docker build runs on the instance (~5-7 min). Watch for `Ready` + `Green`.

---

## 5. Infrastructure (Terraform)

The `fab-admin` application + `fab-admin-prod` environment are defined by the
`module.admin` instance in `terraform/main.tf` (`create_admin_env = true`), using
the reusable `eb-app` module. To change instance size, scaling, or settings, edit
Terraform and apply (see `terraform/README.md`). The env vars (§3) are set
out-of-band via the CLI so secrets stay out of state.

> Note: `PORT=3001` is currently set via the CLI. If you add it to the Terraform
> `admin_env` map, keep the value 3001.

---

## 6. First-time setup (from scratch)

1. **Terraform** `create_admin_env = true` → creates `fab-admin` app,
   `fab-admin-prod` env (shared VPC, public subnets), and the deploy bucket.
2. **DB**: the app uses the shared `claude_ai_athena`. Ensure schema is current
   (`npx prisma db push` or `admin_athena/prisma/create_cmf_dataloader.sql`).
3. **Env vars** (§3), including `PORT=3001`.
4. **RDS SG**: allow the admin instance SG on 5432.
5. **Deploy** the code (§4), verify, then delete the App Runner service.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `502 Bad Gateway` | `PORT` must be **3001** (matches `EXPOSE 3001`); or `process:default` Port must be **80** (Nginx). |
| Build: `markAsUncloneable is not a function` | Node < 22 — Dockerfile must use `node:22-alpine`. |
| Health Red, old version running | Docker build failed → check `eb-engine.log` via `request/retrieve-environment-info`. |
| Login / data errors | `DATABASE_URL` must point to `claude_ai_athena`; RDS SG must allow the admin instances. |
| Invite emails wrong URL | fix `APP_URL`. |
| OTF deploy: "infrastructure permissions issue" at the *Deploying now…* step | The instance role's `mcp-otf-admin-deploy` policy is missing `ec2:DescribeSubnets/SecurityGroups/Vpcs` (needed to create a VPC Lambda). Ensure policy **v2** is default (§3b). |
| OTF deploy throws about missing substrate/role | An `MCP_OTF_*` var is unset (esp. `MCP_OTF_RUNTIME_ROLE_ARN`, which has no code default). Set them all (§3b). |
| OTF assigned tool "can't decrypt" / auth fails in FO | `KEY_ENCRYPTION_SECRET` differs between admin and FO. Both must use the FO key (§3b / ledger UPDATE 9). |
| Admin chat "prepare tools" cut ~60s in prod | The SSE keepalive isn't in the running build — redeploy current code (§3a). Do **not** raise CloudFront timeout. |

---

## 8. Decommission App Runner (after EB is confirmed good)

```bash
aws apprunner delete-service \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2
# then delete the old ECR repo / CodeBuild project / nexusops-ai-build bucket if unused.
```
