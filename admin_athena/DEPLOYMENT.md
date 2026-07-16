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
| **URL** | http://fab-admin-prod.eba-h6wfcmim.us-west-2.elasticbeanstalk.com |
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
| `KEY_ENCRYPTION_SECRET` | AES-256-GCM key |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | seed/admin account |
| `APP_URL`, `ATHENA_URL`, `NEXT_PUBLIC_ATHENA_URL` | app + link back to Fab |
| `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | invite emails |

```bash
aws elasticbeanstalk update-environment --environment-name fab-admin-prod --region us-west-2 \
  --option-settings "Namespace=aws:elasticbeanstalk:application:environment,OptionName=<KEY>,Value=<VALUE>"
```

The RDS security group must allow the admin instance SG on 5432 (same shared VPC,
so no peering needed — unlike the Fab CMF env).

---

## 4. Deploy new code

```bash
cd admin_athena
BUCKET=fab-admin-build-628203515088
VERSION="v$(date +%Y%m%d-%H%M%S)-admin"

zip -r eb-deploy.zip . \
  -x "node_modules/*" ".next/*" "*.zip" ".env" ".env.local" ".env.*.local" \
     ".claude/*" "iam/*" ".git/*" "ref_docs/*" "scripts/*" "*.log"

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

---

## 8. Decommission App Runner (after EB is confirmed good)

```bash
aws apprunner delete-service \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2
# then delete the old ECR repo / CodeBuild project / nexusops-ai-build bucket if unused.
```
