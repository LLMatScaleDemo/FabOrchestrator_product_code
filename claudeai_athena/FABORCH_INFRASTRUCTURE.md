# FabOrchestrator.ai — Infrastructure Reference

Production AWS infrastructure for the FabOrch chat application
(`Claude_ai_athena`). Companion to `FABORCH_DEVELOPMENT.md` (codebase) and
`DEPLOYMENT.md` (runbook).

---

## 1. Account, Region, Identity

| Item | Value |
|---|---|
| AWS Account | `628203515088` |
| Region | `us-west-2` (Oregon) |
| Primary IAM user | `danish` |
| Production URL | http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com |

All FabOrch infrastructure lives in `us-west-2`. The shared RDS instance
also hosts the admin_athena database in the same region/AZ.

---

## 2. Architecture Overview

```
                            ┌─────────────────────────────────────┐
                            │     Internet                        │
                            └─────────────────┬───────────────────┘
                                              │ HTTP :80
                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Application Load Balancer                                       │
│  awseb--AWSEB-mW8PeLrkN60o                                       │
│  • Idle timeout: 600 s (long SSE streams)                        │
│  • Stickiness ON (600 s cookie)                                  │
│  • Target group: awseb-AWSEB-YJUYOJ0YZGOS → port 80 on EC2      │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  EC2 Instance — t3.large (8 GB RAM, 2 vCPU)                      │
│  i-0402daf16d63b3af8 (auto-replaceable via ASG)                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Nginx (port 80)                                           │  │
│  │  • proxy_pass → 127.0.0.1:3000                             │  │
│  │  • proxy_buffering OFF  (REQUIRED for SSE)                 │  │
│  │  • proxy_read_timeout / proxy_send_timeout = 600           │  │
│  │  • proxy_http_version 1.1 + keep-alive                     │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                       │
│  ┌────────────────────────▼───────────────────────────────────┐  │
│  │  Docker container (Next.js standalone)                     │  │
│  │  • Node 20 alpine                                          │  │
│  │  • PORT=3000, HOSTNAME=0.0.0.0                             │  │
│  │  • NODE_OPTIONS="--max-old-space-size=6144" (6 GB heap)    │  │
│  │  • Runs as non-root user nextjs (uid 1001)                 │  │
│  │  • node server.js (Next.js standalone runtime)             │  │
│  └────────────────────────┬───────────────────────────────────┘  │
└────────────────────────────┼─────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐  ┌──────────────┐  ┌─────────────────┐
       │ Anthropic │  │     RDS      │  │  MCP servers    │
       │  API      │  │ PostgreSQL   │  │ (Entegris ×3+)  │
       │ Claude 4.x│  │ athena-poc-db│  │ AWS Lambda+APIGW│
       │  + Files  │  │  port 5432   │  │ JSON-RPC/HTTPS  │
       │  +Container│  │  (private)   │  │                 │
       └──────────┘  └──────────────┘  └─────────────────┘
```

### Request flow

1. Browser → ALB (`:80`, 600 s idle timeout)
2. ALB → Nginx (`:80`, buffering off)
3. Nginx → Docker container (`:3000`, Next.js standalone server)
4. Container → Anthropic API (SSE streaming, `maxDuration = 300` on the route)
5. Container → RDS PostgreSQL (persistence, audit, RBAC)
6. Container → MCP servers (tool execution, 30-second timeout per call)

The critical part: **Nginx `proxy_buffering off`** is what allows token-by-token SSE streaming to flow to the browser. Without it, Nginx would buffer the entire response.

---

## 3. AWS Resources Inventory

| Resource | Identifier | Purpose |
|---|---|---|
| Elastic Beanstalk Application | `faborchestratorai` | Application container |
| Elastic Beanstalk Environment | `faborchestratorai-prod` (env id `e-gdghmvt96r`) | Production environment |
| Solution Stack | `64bit Amazon Linux 2023 v4.12.0 running Docker` | Platform |
| EC2 instance | `i-0402daf16d63b3af8` (replaceable; 1–2 via ASG) | Workload |
| Launch Template | `lt-0a7c75917d27bad73` | Defines AMI, instance type, IAM profile |
| Auto Scaling Group | `awseb-e-gdghmvt96r-stack-AWSEBAutoScalingGroup-9dyplPwYcUKt` | Min 1, Max 2 |
| ALB | `awseb--AWSEB-mW8PeLrkN60o` | Public load balancer |
| ALB Target Group | `awseb-AWSEB-YJUYOJ0YZGOS` | Targets Nginx on port 80 |
| EC2 SG | `sg-00476118d1f1cee71` (`awseb-e-gdghmvt96r-stack-AWSEBSecurityGroup-ZwcF6yesbVFK`) | Instance security group |
| ALB SG | `sg-0549e7d29511a1e43` (`awseb-e-gdghmvt96r-stack-AWSEBLoadBalancerSecurityGroup-woqA905RrsDg`) | ALB security group |
| IAM Instance Profile | `aws-elasticbeanstalk-ec2-role` | EC2 permissions |
| IAM Role (instance) | `aws-elasticbeanstalk-ec2-role` | EB Web Tier + Multicontainer + Worker + ECR ReadOnly |
| IAM Role (service) | `aws-elasticbeanstalk-service-role` | Enhanced health + managed updates |
| S3 Bucket | `faborchestratorai-build-628203515088` | Deployment zip storage (`eb-deploy.zip`) |
| S3 Bucket | `elasticbeanstalk-us-west-2-628203515088` | EB internal (auto-created) |
| RDS Instance | `athena-poc-db` (db.t4g.micro, shared) | PostgreSQL |
| RDS DB | `claude_ai_athena` | FabOrch + admin_athena schema |
| RDS SG | `sg-0af6fdeed5a3882f2` | Allows `sg-00476118d1f1cee71` (EB) on 5432 |
| VPC | `vpc-0521d5dc5d2554e5a` | Shared (with admin_athena) |
| Subnets | `subnet-06faf688f0ea464ac` (us-west-2a), `subnet-0e0f6ddda096487f3` (us-west-2b), `subnet-07a09ab450b741c55` (us-west-2c) | Multi-AZ |

Note: the FabOrch deployment is **not** packaged into a separate ECR image
the way admin_athena is. EB builds the Docker image **on the EC2 instance
itself** from the source zip during each deploy.

---

## 4. Compute — Elastic Beanstalk

### Platform

- 64-bit Amazon Linux 2023, EB platform v4.12.0, Docker container runtime.
- Single-Docker-Container mode (not multi-container ECS).
- The EC2 host runs `docker build` against the project Dockerfile during deploy, then `docker run`s the resulting image with environment variables injected from EB config.

### Instance type

- **`t3.large`** — 8 GB RAM, 2 vCPU.
- Set via `aws:autoscaling:launchconfiguration / InstanceType = t3.large`.
- Sized to allow `NODE_OPTIONS=--max-old-space-size=6144` (6 GB heap) for large Claude context windows (200K tokens). Leaves ~2 GB for OS + Docker + Nginx.

### Auto Scaling

- Min: 1, Max: 2 instances.
- Set via `aws:autoscaling:asg`.
- Stickiness ON so an in-flight SSE stream stays bound to its instance.

### Health monitoring

- Enhanced health reporting (`SystemType = enhanced` under `aws:elasticbeanstalk:healthreporting:system`).
- ALB health checks target port 80 (Nginx), HTTP GET `/` — Nginx proxies through to Next.js's root handler.

### `.ebextensions/` (commit-tracked)

These files are bundled into every deploy zip and applied automatically by EB:

| File | What it sets |
|---|---|
| `.ebextensions/01-alb.config` | `aws:elbv2:loadbalancer / IdleTimeout = 600`; `aws:elasticbeanstalk:environment:process:default / Port=80, Protocol=HTTP, StickinessEnabled=true, StickinessLBCookieDuration=600` |
| `.ebextensions/02-instance.config` | `aws:elasticbeanstalk:application:environment / NODE_OPTIONS = "--max-old-space-size=6144"` |

### `.platform/nginx/conf.d/proxy.conf` (commit-tracked)

```nginx
proxy_read_timeout 600;
proxy_send_timeout 600;
proxy_connect_timeout 60;
proxy_buffering off;            # <-- critical for SSE
proxy_http_version 1.1;
proxy_set_header Connection ""; # enables keep-alive to Docker container
```

**Why these settings**:
- 600-s timeouts match the ALB idle timeout (otherwise Nginx kills the connection at 60 s).
- `proxy_buffering off` is the SSE-critical knob: with buffering on, Nginx waits for the full response before forwarding, breaking real-time streaming.
- HTTP/1.1 + empty `Connection` header enables keep-alive between Nginx and the container.

---

## 5. Container Image (Dockerfile)

`Dockerfile` at repo root, three-stage build producing a ~227 MB image:

```dockerfile
# Stage 1: deps — public.ecr.aws/docker/library/node:20-alpine (avoids
# Docker Hub rate limiting). Installs libc6-compat then npm ci (full deps
# including dev for the build step).

# Stage 2: builder — copies node_modules from deps + the full source,
# runs `npx prisma generate` then `npm run build` (Next.js standalone).

# Stage 3: runner — minimal final image. Copies:
#   - public/
#   - .next/standalone/  (the entire standalone bundle)
#   - .next/static/      (Next.js static assets)
#   - lib/generated/     (Prisma client — explicit copy required because
#                         the standalone bundle's tracing misses it)
# Adds non-root user `nextjs` (uid 1001), CMD ["node", "server.js"].
```

Key configuration:
- `next.config.ts` sets `output: "standalone"` — without this the runner stage has nothing to run.
- The Prisma generated client is explicitly copied at line 42 — required because Next.js's file tracing doesn't always pick it up.

---

## 6. Networking

### VPC layout
- VPC: `vpc-0521d5dc5d2554e5a` (shared with admin_athena and RDS).
- Three public subnets (one per AZ in us-west-2a/b/c).
- The ALB and EC2 instance both live in these subnets (public).
- RDS is in a separate subnet group, reachable only from the EB security group.

### Security groups

| SG | Allows |
|---|---|
| `sg-0549e7d29511a1e43` (ALB) | Inbound TCP 80 from 0.0.0.0/0 (public). Outbound: SG → EC2 SG. |
| `sg-00476118d1f1cee71` (EC2) | Inbound TCP 80 from ALB SG only. Outbound: all (so it can reach Anthropic, MCP servers, RDS). |
| `sg-0af6fdeed5a3882f2` (RDS) | Inbound TCP 5432 from EC2 SG `sg-00476118d1f1cee71` only. |

### Outbound dependencies

The EC2 container needs egress to:
- `api.anthropic.com` (Anthropic API)
- All the Entegris MCP API Gateway endpoints (e.g. `https://<id>.execute-api.us-west-2.amazonaws.com/mcp`)
- The MCP endpoints registered in the `mcp_registry` table — currently 10 known servers (CMF Critical Manufacturing, CM MES Assembly, CM MES Lab Data, Opcenter Siemens, Opcenter CoreSi, PSI Quantum, Lumentum, Genealogy, Bottleneck Analysis, Scrap Pareto). Operator Performance Analysys was removed 2026-05-13.
- `smtp.gmail.com:587` (SMTP for invitation / password-reset emails)
- RDS at `athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432`

No NAT gateway required because instances are in public subnets.

---

## 7. Database — RDS PostgreSQL

| Item | Value |
|---|---|
| Instance | `athena-poc-db` |
| Engine | PostgreSQL |
| Class | `db.t4g.micro` (shared with admin_athena, cost ≈ $0) |
| Endpoint | `athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com` |
| Port | `5432` |
| Database | `claude_ai_athena` |
| Master user | `postgres` |
| Master password | `<DB_PASSWORD>` (in EB env vars only) |
| Backups | RDS automated (default 7 days) |
| Multi-AZ | No (POC; would enable for prod with real traffic) |

Schema is managed via Prisma 7.3.0 from `prisma/schema.prisma`. To push
schema changes:

```bash
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
  npx prisma db push
```

For schema-changing migrations done manually (as for the token/cost
migration on 2026-05-12), see the SQL in `FABORCH_DEVELOPMENT.md` §5.

### Sharing with admin_athena

Both apps use the same Postgres database. They share:
- All chat-side tables (User, Session, Conversation, Message, …).
- All audit tables (`user_session_logs`, `error_audit_logs`, `prompt_audit_logs`, `error_catalog`, `audit_logs`, `usage_records`, daily counters).
- The MCP registry (`mcp_registry`) and connections (`mcp_connections`).

Admin app **writes** to: `roles`, `mcp_registry`, `error_catalog`, plus
updates `error_audit_logs.status` (resolve), `users` (suspend/role
changes). FabOrch **writes** to: all the rest.

---

## 8. Environment Variables (production)

Set on the EB environment via the AWS Console / CLI. Updating them
triggers a rolling restart (~2-3 min).

| Variable | Source | Purpose |
|---|---|---|
| `NODE_ENV` | EB option setting | `production` |
| `PORT` | EB option setting | `3000` |
| `HOSTNAME` | EB option setting | `0.0.0.0` (Docker networking) |
| `NODE_OPTIONS` | `.ebextensions/02-instance.config` | `--max-old-space-size=6144` |
| `DATABASE_URL` | EB secret | `postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena` |
| `KEY_ENCRYPTION_SECRET` | EB secret | `<KEY_ENCRYPTION_SECRET>` (64 hex chars = AES-256 key) |
| `ANTHROPIC_API_KEY` | EB secret | Org-level Anthropic API key (`sk-ant-api03-…`) |

Update one variable:

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ANTHROPIC_API_KEY,Value=sk-ant-new-key" \
  --region us-west-2
```

View current values:

```bash
aws elasticbeanstalk describe-configuration-settings \
  --application-name faborchestratorai \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --query 'ConfigurationSettings[0].OptionSettings[?Namespace==`aws:elasticbeanstalk:application:environment`]'
```

⚠️ **Never** commit values for `DATABASE_URL`, `ANTHROPIC_API_KEY`, or
`KEY_ENCRYPTION_SECRET` to the repo. The deploy zip exclusion list drops
`.env`.

---

## 9. IAM

### `aws-elasticbeanstalk-ec2-role` (instance profile)

Attached managed policies:
- `AWSElasticBeanstalkWebTier`
- `AWSElasticBeanstalkMulticontainerDocker`
- `AWSElasticBeanstalkWorkerTier`
- `AmazonEC2ContainerRegistryReadOnly`

Grants:
- Read application versions from S3.
- Pull Docker images from ECR public (the Dockerfile uses `public.ecr.aws/docker/library/node:20-alpine`).
- Write logs / health to CloudWatch.

Trust policy: `ec2.amazonaws.com`.

### `aws-elasticbeanstalk-service-role` (service role)

Attached managed policies:
- `AWSElasticBeanstalkEnhancedHealth`
- `AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy`

Trust policy: `elasticbeanstalk.amazonaws.com` (with `sts:ExternalId =
elasticbeanstalk`).

### Developer IAM (for deploys)

User `danish` (or any deploying identity) needs permissions to:
- `s3:PutObject` on `faborchestratorai-build-628203515088`
- `elasticbeanstalk:CreateApplicationVersion`, `UpdateEnvironment`, `DescribeEnvironments`, `DescribeEvents`
- `ec2:DescribeSecurityGroups` for troubleshooting

---

## 10. CI/CD — Deployment Workflow

There's no GitHub-triggered CD pipeline. Deploys are triggered manually by
zipping the project, uploading to S3, creating a new application version,
and updating the environment.

### `buildspec.yml` (alternate path)

The repo also includes a `buildspec.yml` for the CodeBuild-based ECR path
(legacy / fallback) — but production currently uses the direct
zip-and-upload workflow described below. The buildspec is not wired into
any active pipeline.

### Production deploy steps (full runbook in `DEPLOYMENT.md`)

```bash
# 1. Zip source (excludes node_modules, .next, .git, .claude, .planning, iam, ref_docs)
# (the canonical script in DEPLOYMENT.md uses zip; on Windows use the
#  PowerShell System.IO.Compression script.)

# 2. Upload to S3
aws s3 cp eb-deploy.zip \
  s3://faborchestratorai-build-628203515088/eb-deploy.zip \
  --region us-west-2

# 3. Create application version
VERSION="v$(date +%Y%m%d-%H%M%S)"
aws elasticbeanstalk create-application-version \
  --application-name faborchestratorai \
  --version-label $VERSION \
  --source-bundle S3Bucket=faborchestratorai-build-628203515088,S3Key=eb-deploy.zip \
  --region us-west-2

# 4. Deploy to environment
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --version-label $VERSION \
  --region us-west-2

# 5. Poll until Status=Ready, Health=Green
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,VersionLabel:VersionLabel}'
```

**Timeline**: ~5-7 minutes total (zip+upload ~30 s, EB rolls the new version onto the instance: ~3-5 min Docker build + ~30 s health check pass).

**Versioning convention**: timestamp + optional descriptor, e.g. `v20260512-123440-tokens`, `v20260513-164150-mcpclean`.

---

## 11. Monitoring & Observability

### Live status

```bash
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,VersionLabel:VersionLabel,URL:CNAME}'
```

### Events

```bash
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --max-items 20
# Filter on severity:
#   --severity ERROR | WARN | INFO
```

### Container logs (tail)

```bash
aws elasticbeanstalk request-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type tail \
  --region us-west-2

# Wait ~10 s, then:
LOG_URL=$(aws elasticbeanstalk retrieve-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type tail \
  --region us-west-2 \
  --query 'EnvironmentInfo[0].Message' --output text)
curl -s "$LOG_URL" | tail -200
```

### Full log bundle

```bash
aws elasticbeanstalk request-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type bundle --region us-west-2
# ... retrieve and unzip ...
# Key files in the bundle:
#   var/log/eb-docker/containers/eb-current-app/*.log   ← application stdout/stderr
#   var/log/nginx/access.log
#   var/log/nginx/error.log
#   var/log/eb-engine.log
#   var/log/docker-events.log
```

### CloudWatch Logs

The Docker container's stdout is forwarded to CloudWatch via the EB
platform. Logger output (`lib/logger.ts`) is JSON-per-line, so CloudWatch
Logs Insights queries can filter on `errorId`, `type`, `userId`, etc:

```sql
fields @timestamp, errorId, type, userId, route, userMessage
| filter level = "ERROR"
| filter type = "RESPONSE_TIMEOUT"
| sort @timestamp desc
```

### ALB target health

```bash
TG_ARN=$(aws elbv2 describe-target-groups --region us-west-2 \
  --query 'TargetGroups[?starts_with(TargetGroupName, `awseb`)].TargetGroupArn' \
  --output text)

aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN --region us-west-2
```

### App-side audit tables

For business observability (not infra), query the live DB:
- `error_audit_logs` — every FabOrchError instance.
- `prompt_audit_logs` — every user prompt + cost + tool I/O.
- `user_session_logs` — login/idle/logout history.
- `usage_records` — per-LLM-call token counts (used by role daily-limit checks).

---

## 12. Scaling Levers

### Vertical scaling (instance type)

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.xlarge" \
  --region us-west-2
```

| Instance | RAM | vCPU | ≈ Monthly | Concurrent users |
|---|---|---|---|---|
| `t3.medium` | 4 GB | 2 | $30 | 1-3 |
| **`t3.large` (current)** | 8 GB | 2 | $60 | 5-10 |
| `t3.xlarge` | 16 GB | 4 | $120 | 10-20 |
| `t3.2xlarge` | 32 GB | 8 | $240 | 20-40 |

When increasing instance type, also bump `NODE_OPTIONS=--max-old-space-size`
in `.ebextensions/02-instance.config` proportionally (leave ~25 % for OS).

### Horizontal scaling (ASG)

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=2" \
    "Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=4" \
  --region us-west-2
```

Stickiness is already ON, so an in-flight stream stays on the same
instance; horizontal scaling just adds capacity for new connections.

### ALB idle timeout

Max 4000 s. Current: 600 s. Match `proxy_read_timeout` in `proxy.conf`
when changing.

---

## 13. HTTPS (Not Yet Configured)

The production URL is currently `http://`. To add HTTPS:

```bash
# 1. Request ACM certificate
aws acm request-certificate \
  --domain-name <your-domain>.com \
  --validation-method DNS \
  --region us-west-2

# 2. Complete DNS validation (add CNAME records to Route 53 / your DNS).

# 3. Attach to EB
CERT_ARN="arn:aws:acm:us-west-2:628203515088:certificate/..."
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elbv2:listener:443,OptionName=Protocol,Value=HTTPS" \
    "Namespace=aws:elbv2:listener:443,OptionName=SSLCertificateArns,Value=$CERT_ARN" \
    "Namespace=aws:elbv2:listener:default,OptionName=ListenerEnabled,Value=true" \
  --region us-west-2
```

---

## 14. Cost Snapshot

| Service | Monthly (approx) |
|---|---|
| EC2 t3.large × 1 | ~$60 |
| ALB | ~$16 + $0.008 / LCU-hr |
| S3 (deploy zips, < 100 MB) | < $0.10 |
| RDS (shared, no incremental cost) | $0 |
| CloudWatch Logs (small volume) | < $1 |
| Anthropic API | usage-based (see `prompt_audit_logs.*_cost`) |
| **Total infra** | **~$77 / month** |

Anthropic usage is now trackable in real time via the
`prompt_audit_logs.request_cost + retrieval_cost + response_cost`
columns; aggregated by the admin app's `prompt_quality_summary` tool.

---

## 15. Troubleshooting Playbook

### 502 Bad Gateway from the ALB

- Most often: target group port set wrong. Should be **80** (Nginx), not 3000.
  Fix:
  ```bash
  aws elasticbeanstalk update-environment \
    --environment-name faborchestratorai-prod \
    --option-settings \
      "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=Port,Value=80" \
    --region us-west-2
  ```

### Health red, Status=Severe

1. `describe-events --severity ERROR` to see what EB engine logged.
2. Pull tail logs (§11). Most common causes:
   - Missing `DATABASE_URL` → app crash on Prisma init.
   - Prisma migration drift → app starts but queries fail.
   - Docker build failure → see `var/log/eb-engine.log`.

### Database connection refused

- EB security group rule missing on RDS SG. Re-add:
  ```bash
  aws ec2 authorize-security-group-ingress \
    --group-id sg-0af6fdeed5a3882f2 \
    --protocol tcp --port 5432 \
    --source-group sg-00476118d1f1cee71 \
    --region us-west-2
  ```

### SSE stream times out at exactly 60 s

- Nginx is reverting to defaults — confirm `.platform/nginx/conf.d/proxy.conf`
  is in the deploy zip and EB picked it up. Check `nginx -T` in a shell on
  the instance, or look at `var/log/nginx/error.log`.

### SSE stream times out at exactly 600 s

- A response is genuinely taking >10 min. Investigate the tool calls — an
  MCP server is hanging or the model is in a long loop. Raise the ALB
  timeout if legit traffic needs more.

### Out-of-memory (instance unhealthy → recovery)

- Check `NODE_OPTIONS` is `--max-old-space-size=6144` (see §4).
- If memory pressure is real, upgrade to `t3.xlarge`. The 200K-token
  context window with file uploads can spike memory significantly.

### Deploy stuck in OPERATION_IN_PROGRESS

- Wait 3-5 min — that's normal for a rolling Docker rebuild on the instance.
- If still stuck past 10 min, check `describe-events` for ERROR rows. EB
  retries up to 3× before declaring failed.

---

## 16. Disaster Recovery

### What's backed up
- **RDS** — automated daily backups, 7-day retention (RDS default).
- **S3 deploy zips** — every uploaded `eb-deploy.zip` is overwritten in
  place; previous **EB application versions** are preserved by EB and
  re-deployable from the console.

### What's not
- Code is on developer laptops + GitHub (if pushed). The local FabOrch
  repo at `D:\FabOrchAudit&Error\two_applications\Claude_ai_athena` is not
  itself a git working tree (per project setup), so commits should be
  pushed to wherever the canonical repo lives.

### Rollback procedure

```bash
# List recent versions:
aws elasticbeanstalk describe-application-versions \
  --application-name faborchestratorai --region us-west-2 \
  --query 'ApplicationVersions[*].{Version:VersionLabel,Date:DateCreated}' \
  --output table

# Re-deploy a previous version:
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --version-label v20260511-150717 \
  --region us-west-2
```

---

## 17. From-Scratch Recreation

See `DEPLOYMENT.md` § "First-Time Setup (From Scratch)" — covers RDS DB
creation, S3 bucket, IAM roles, EB application + environment creation,
env var seeding, and the EB → RDS security-group ingress rule. Roughly
~20 minutes if all the AWS CLI invocations succeed first try.

---

## 18. Active External Dependencies

| Dep | Endpoint | Failure mode |
|---|---|---|
| Anthropic API | `api.anthropic.com` | `LAMBDA_MCP_CRASH` / `RESPONSE_TIMEOUT` |
| MCP servers (×10) | various `*.execute-api.us-west-2.amazonaws.com/mcp` | `SQL_CALL_FAILURE` / `LAMBDA_MCP_CRASH` |
| SMTP (Gmail) | `smtp.gmail.com:587` | Invitation / password-reset emails fail silently; logged |
| RDS | `athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432` | App start fails; all routes 500 |

All of these are reflected in the REQ-01 error catalog so user-facing
messages stay consistent regardless of which dependency hiccuped.

---

## 19. Cleanup / Decommission

Full teardown sequence (DESTRUCTIVE — only run when retiring):

```bash
# 1. Terminate the EB environment (~5 min)
aws elasticbeanstalk terminate-environment \
  --environment-name faborchestratorai-prod \
  --region us-west-2

# 2. Wait for Status=Terminated, then delete the application:
aws elasticbeanstalk delete-application \
  --application-name faborchestratorai \
  --terminate-env-by-force \
  --region us-west-2

# 3. Detach + delete IAM roles and instance profile.
# 4. Revoke the RDS SG rule that allowed the EB SG.
# 5. Empty + delete the S3 deploy bucket.
# 6. Drop the database (DESTRUCTIVE — last):
PGPASSWORD=<DB_PASSWORD> psql \
  -h athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com \
  -U postgres -p 5432 \
  -c "DROP DATABASE claude_ai_athena;"
```

(See `DEPLOYMENT.md` for the full IAM-detach commands.)

---

## 20. Legacy / Historical

### App Runner (deprecated)

A previous deployment used AWS App Runner (URL
`https://ppizczc9gc.us-west-2.awsapprunner.com`) but App Runner's
120-second hard request timeout caused network errors during long SSE
streams. **Moved to Elastic Beanstalk in early 2026** with the ALB
configured for 600 s idle timeout. The App Runner service may still exist
in the account but is not in active use.

The sister app **admin_athena** still runs on App Runner (its
requirements are short request/response cycles, no streaming over 30 s).

---

## 21. Quick-Reference Commands

```bash
# Current environment state
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod --region us-west-2 \
  --query 'Environments[0]'

# Recent events
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod --region us-west-2 \
  --max-items 20

# Tail container logs
aws elasticbeanstalk request-environment-info \
  --environment-name faborchestratorai-prod --info-type tail --region us-west-2
sleep 10
LOG_URL=$(aws elasticbeanstalk retrieve-environment-info \
  --environment-name faborchestratorai-prod --info-type tail --region us-west-2 \
  --query 'EnvironmentInfo[0].Message' --output text)
curl -s "$LOG_URL" | tail -200

# ALB idle timeout (should be 600)
aws elbv2 describe-load-balancer-attributes \
  --load-balancer-arn $(aws elbv2 describe-load-balancers --region us-west-2 \
    --query 'LoadBalancers[?starts_with(LoadBalancerName, `awseb`)].LoadBalancerArn' \
    --output text) \
  --region us-west-2 \
  --query 'Attributes[?Key==`idle_timeout.timeout_seconds`].Value' --output text

# DB connectivity
PGPASSWORD=<DB_PASSWORD> psql \
  -h athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com \
  -U postgres -p 5432 -d claude_ai_athena -c "SELECT NOW();"
```

---

*Last reviewed: 2026-05-13. Reflects post-migration state including
prompt-audit token/cost columns and the Operator Performance Analysys
MCP removal.*
