# AWS Elastic Beanstalk Deployment Guide - FabOrchestrator.ai

Complete deployment guide for the FabOrchestrator.ai Next.js application on AWS Elastic Beanstalk using Docker platform with Application Load Balancer.

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐         ┌──────────────────────────────────────┐
│   Source Code    │────────▶│    S3 Bucket    │────────▶│     Elastic Beanstalk Environment     │
│   (eb-deploy.zip)│         │ (deployment zip) │         │                                      │
└─────────────────┘         └─────────────────┘         │  ┌─────────────────────────────────┐  │
                                                         │  │   Application Load Balancer     │  │
                                                         │  │   (600s idle timeout, HTTP:80)  │  │
                                                         │  └────────────┬────────────────────┘  │
                                                         │               │                       │
                                                         │  ┌────────────▼────────────────────┐  │
                                                         │  │   EC2 Instance (t3.large)       │  │
                                                         │  │   ┌─────────────────────────┐   │  │
                                                         │  │   │  Nginx (port 80)        │   │  │
                                                         │  │   │  proxy_pass → :3000     │   │  │
                                                         │  │   │  proxy_buffering off    │   │  │
                                                         │  │   │  timeout: 600s          │   │  │
                                                         │  │   └────────────┬────────────┘   │  │
                                                         │  │                │                 │  │
                                                         │  │   ┌────────────▼────────────┐   │  │
                                                         │  │   │  Docker Container       │   │  │
                                                         │  │   │  Node.js (port 3000)    │   │  │
                                                         │  │   │  Next.js Standalone     │   │  │
                                                         │  │   │  6 GB heap memory       │   │  │
                                                         │  │   └─────────────────────────┘   │  │
                                                         │  └─────────────────────────────────┘  │
                                                         └──────────────────────────────────────┘
                                                                          │
                                                         ┌────────────────▼─────────────────┐
                                                         │   AWS RDS PostgreSQL             │
                                                         │   athena-poc-db (db.t4g.micro)   │
                                                         │   Database: claude_ai_athena      │
                                                         └─────────────────────────────────┘
```

### Request Flow

1. User browser → ALB (port 80, 600s idle timeout)
2. ALB → Nginx reverse proxy on EC2 (port 80, proxy_buffering off)
3. Nginx → Docker container (port 3000, Next.js standalone server)
4. Next.js → Anthropic API (SSE streaming, up to 300s maxDuration)
5. Next.js → RDS PostgreSQL (message persistence, session management)

---

## Current Deployment

| Item | Value |
|------|-------|
| **URL** | http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com |
| **Region** | us-west-2 |
| **AWS Account** | 628203515088 |
| **Platform** | 64bit Amazon Linux 2023 v4.12.0 running Docker |
| **Instance Type** | t3.large (8 GB RAM, 2 vCPU) |
| **ALB Idle Timeout** | 600 seconds |
| **Nginx Proxy Timeout** | 600 seconds (buffering disabled) |
| **Node.js Heap** | 6 GB (--max-old-space-size=6144) |
| **Auto Scaling** | Min: 1, Max: 2 instances |
| **Health Monitoring** | Enhanced health reporting |
| **Database** | RDS PostgreSQL - `claude_ai_athena` on `athena-poc-db` (us-west-2, db.t4g.micro) |
| **Status** | RUNNING (Green) |

---

## AWS Resources

| Resource | Name / Identifier | Purpose |
|----------|-------------------|---------|
| EB Application | `faborchestratorai` | Application container |
| EB Environment | `faborchestratorai-prod` (ID: `e-gdghmvt96r`) | Production environment |
| S3 Bucket | `faborchestratorai-build-628203515088` | Deployment zip storage |
| S3 Bucket | `elasticbeanstalk-us-west-2-628203515088` | EB internal storage (auto-created) |
| ALB | `awseb--AWSEB-mW8PeLrkN60o` | Load balancer (600s timeout) |
| ALB Target Group | `awseb-AWSEB-YJUYOJ0YZGOS` | Routes to EC2 port 80 |
| Auto Scaling Group | `awseb-e-gdghmvt96r-stack-AWSEBAutoScalingGroup-9dyplPwYcUKt` | 1-2 t3.large instances |
| Launch Template | `lt-0a7c75917d27bad73` | EC2 launch configuration |
| EC2 Instance | `i-0402daf16d63b3af8` | Current running instance |
| Security Group | `sg-00476118d1f1cee71` (`awseb-e-gdghmvt96r-stack-AWSEBSecurityGroup-ZwcF6yesbVFK`) | EB EC2 instance security group |
| Security Group | `sg-0549e7d29511a1e43` (`awseb-e-gdghmvt96r-stack-AWSEBLoadBalancerSecurityGroup-woqA905RrsDg`) | ALB security group |
| IAM Instance Profile | `aws-elasticbeanstalk-ec2-role` | EC2 permissions (ECR pull, CloudWatch, S3) |
| IAM Role | `aws-elasticbeanstalk-ec2-role` | EC2 role with EB + ECR policies |
| IAM Role | `aws-elasticbeanstalk-service-role` | EB service role (health, updates) |
| RDS Instance | `athena-poc-db` | Shared PostgreSQL (db.t4g.micro) |
| RDS Database | `claude_ai_athena` | Application database |
| RDS Security Group | `sg-0af6fdeed5a3882f2` | Allows EB SG `sg-00476118d1f1cee71` on port 5432 |
| VPC | `vpc-0521d5dc5d2554e5a` | Shared VPC |
| Subnets | `subnet-06faf688f0ea464ac` (us-west-2a), `subnet-0e0f6ddda096487f3` (us-west-2b), `subnet-07a09ab450b741c55` (us-west-2c) | Multi-AZ deployment |

---

## Prerequisites

```bash
# AWS CLI installed and configured
aws configure
# AWS Account: 628203515088
# Region: us-west-2
# Output: json

# Verify access
aws sts get-caller-identity
```

---

## Project Configuration Files

### Directory Structure

```
project-root/
├── Dockerfile                     # Multi-stage Docker build
├── .ebextensions/                 # EB configuration
│   ├── 01-alb.config             # ALB timeout, sticky sessions, port
│   └── 02-instance.config        # Node.js memory limit
├── .platform/                     # Platform-level overrides
│   └── nginx/conf.d/
│       └── proxy.conf            # Nginx proxy timeouts, disable buffering
├── buildspec.yml                  # CodeBuild spec (for ECR builds)
└── next.config.ts                 # Next.js standalone output
```

### Dockerfile

Multi-stage build producing a ~227 MB production image.

```dockerfile
# Stage 1: Dependencies
FROM public.ecr.aws/docker/library/node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

# Stage 2: Builder
FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated ./lib/generated

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
```

**Key details:**
- Uses ECR public images to avoid Docker Hub rate limiting
- `output: "standalone"` in `next.config.ts` enables the standalone build
- Prisma client (`lib/generated`) must be explicitly copied to the runner stage
- Runs as non-root user `nextjs` (UID 1001)

### .ebextensions/01-alb.config

```yaml
option_settings:
  # ALB idle timeout: 600 seconds (10 min) for long SSE streaming
  aws:elbv2:loadbalancer:
    IdleTimeout: 600

  # ALB targets Nginx (port 80), which proxies to Docker container (port 3000)
  aws:elasticbeanstalk:environment:process:default:
    Port: 80
    Protocol: HTTP
    StickinessEnabled: true
    StickinessLBCookieDuration: 600
```

**Why these settings:**
- `IdleTimeout: 600` — Allows SSE streams to remain open for up to 10 minutes without data. The app's `maxDuration` is 300s (5 min), so 600s gives double the headroom.
- `Port: 80` — ALB health checks and traffic target Nginx (port 80), NOT the Docker container (port 3000) directly. Nginx then proxies to port 3000. **Setting this to 3000 will cause 502 errors.**
- `StickinessEnabled` — Ensures a user's requests go to the same instance during a session, important for streaming state consistency.

### .ebextensions/02-instance.config

```yaml
option_settings:
  # Increase Node.js memory limit for large context windows
  aws:elasticbeanstalk:application:environment:
    NODE_OPTIONS: "--max-old-space-size=6144"
```

**Why:** The t3.large has 8 GB RAM. Setting Node.js heap to 6 GB leaves ~2 GB for the OS, Docker, and Nginx. Large conversation context windows (200k tokens) with tool results and file data can consume significant memory.

### .platform/nginx/conf.d/proxy.conf

```nginx
proxy_read_timeout 600;
proxy_send_timeout 600;
proxy_connect_timeout 60;
proxy_buffering off;
proxy_http_version 1.1;
proxy_set_header Connection "";
```

**Why these settings:**
- `proxy_read_timeout 600` / `proxy_send_timeout 600` — Matches the ALB idle timeout. Without this, Nginx would timeout at its default 60s.
- `proxy_buffering off` — **Critical for SSE streaming.** Without this, Nginx buffers the entire response before sending to the client, breaking real-time token streaming.
- `proxy_http_version 1.1` + `Connection ""` — Enables HTTP keep-alive between Nginx and the Docker container for better performance.

### next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

**Required** for the multi-stage Docker build. Produces a self-contained `server.js` with all dependencies bundled.

---

## Environment Variables

### Current Variables on EB

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Enables production optimizations |
| `DATABASE_URL` | `postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena` | RDS PostgreSQL connection string |
| `KEY_ENCRYPTION_SECRET` | `<KEY_ENCRYPTION_SECRET>` | 64-char hex key for AES-256-GCM encryption of API keys and MCP credentials |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | Server-side Anthropic API key (users can also set their own in settings) |
| `HOSTNAME` | `0.0.0.0` | Binds to all interfaces (required for Docker networking) |
| `PORT` | `3000` | Application port (Nginx proxies from 80 to 3000) |
| `NODE_OPTIONS` | `--max-old-space-size=6144` | Node.js heap size: 6 GB |

### How to Update Environment Variables

```bash
# Update a single variable
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ANTHROPIC_API_KEY,Value=sk-ant-new-key-here" \
  --region us-west-2

# Update multiple variables at once
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=VAR1,Value=value1" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=VAR2,Value=value2" \
  --region us-west-2

# View current environment variables
aws elasticbeanstalk describe-configuration-settings \
  --application-name faborchestratorai \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --query 'ConfigurationSettings[0].OptionSettings[?Namespace==`aws:elasticbeanstalk:application:environment`].{Key:OptionName,Value:Value}'
```

**Note:** Updating env vars triggers a rolling restart of the environment (~2-3 minutes).

---

## Deployment

### Redeployment Steps (Deploy New Code)

```bash
# 1. Package source code (excludes unnecessary files)
cd /Users/vikramans/Project_LLMatscale/Athena_project/Claude_ai_athena
zip -r eb-deploy.zip . \
  -x "node_modules/*" \
  -x ".next/*" \
  -x "source.zip" \
  -x "eb-deploy.zip" \
  -x ".env" \
  -x ".claude/*" \
  -x "iam/*" \
  -x ".git/*" \
  -x "ref_docs/*"

# 2. Upload to S3
aws s3 cp eb-deploy.zip s3://faborchestratorai-build-628203515088/eb-deploy.zip --region us-west-2

# 3. Create new application version with timestamp label
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

# 5. Monitor deployment (repeat until Status=Ready, Health=Green)
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,VersionLabel:VersionLabel}'

# 6. Watch deployment events
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --max-items 10 \
  --query 'Events[*].{Time:EventDate,Severity:Severity,Message:Message}'
```

**Deployment timeline:** ~5-7 minutes (Docker build on EC2 + health check pass).

### Quick Redeploy Script

Save as `deploy.sh` in the project root:

```bash
#!/bin/bash
set -e

echo "=== FabOrchestrator.ai EB Deployment ==="

# Package
echo "[1/5] Packaging source..."
zip -r eb-deploy.zip . \
  -x "node_modules/*" ".next/*" "source.zip" "eb-deploy.zip" \
  ".env" ".claude/*" "iam/*" ".git/*" "ref_docs/*" > /dev/null

# Upload
echo "[2/5] Uploading to S3..."
aws s3 cp eb-deploy.zip s3://faborchestratorai-build-628203515088/eb-deploy.zip --region us-west-2 > /dev/null

# Version
VERSION="v$(date +%Y%m%d-%H%M%S)"
echo "[3/5] Creating version: $VERSION"
aws elasticbeanstalk create-application-version \
  --application-name faborchestratorai \
  --version-label $VERSION \
  --source-bundle S3Bucket=faborchestratorai-build-628203515088,S3Key=eb-deploy.zip \
  --region us-west-2 > /dev/null

# Deploy
echo "[4/5] Deploying..."
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --version-label $VERSION \
  --region us-west-2 > /dev/null

# Wait
echo "[5/5] Waiting for deployment..."
while true; do
  STATUS=$(aws elasticbeanstalk describe-environments \
    --environment-names faborchestratorai-prod \
    --region us-west-2 \
    --query 'Environments[0].Status' --output text)
  HEALTH=$(aws elasticbeanstalk describe-environments \
    --environment-names faborchestratorai-prod \
    --region us-west-2 \
    --query 'Environments[0].Health' --output text)
  echo "  Status: $STATUS | Health: $HEALTH"
  if [ "$STATUS" = "Ready" ]; then break; fi
  sleep 15
done

echo ""
echo "=== Deployment complete ==="
echo "URL: http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com"

# Cleanup
rm -f eb-deploy.zip
```

---

## First-Time Setup (From Scratch)

If you need to recreate the entire EB deployment from scratch:

### Step 1: Create RDS Database

Using the existing RDS instance `athena-poc-db`:

```bash
# Create database
PGPASSWORD=<DB_PASSWORD> psql \
  -h athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com \
  -U postgres -p 5432 \
  -c "CREATE DATABASE claude_ai_athena;"

# Push Prisma schema
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
  npx prisma db push
```

### Step 2: Create S3 Bucket

```bash
aws s3 mb s3://faborchestratorai-build-628203515088 --region us-west-2
```

### Step 3: Create IAM Roles

**EC2 Instance Role + Instance Profile:**

```bash
# Create role
aws iam create-role \
  --role-name aws-elasticbeanstalk-ec2-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Create instance profile and attach role
aws iam create-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role
aws iam add-role-to-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --role-name aws-elasticbeanstalk-ec2-role
```

**EB Service Role:**

```bash
aws iam create-role \
  --role-name aws-elasticbeanstalk-service-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "elasticbeanstalk.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {"sts:ExternalId": "elasticbeanstalk"}
      }
    }]
  }'

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy
```

**Wait ~10 seconds** for IAM propagation before proceeding.

### Step 4: Create EB Application

```bash
aws elasticbeanstalk create-application \
  --application-name faborchestratorai \
  --description "FabOrchestrator.ai - AI Chat Application" \
  --region us-west-2
```

### Step 5: Package and Upload Source

```bash
zip -r eb-deploy.zip . \
  -x "node_modules/*" ".next/*" "source.zip" "eb-deploy.zip" \
  ".env" ".claude/*" "iam/*" ".git/*" "ref_docs/*"

aws s3 cp eb-deploy.zip s3://faborchestratorai-build-628203515088/eb-deploy.zip --region us-west-2
```

### Step 6: Create Application Version

```bash
aws elasticbeanstalk create-application-version \
  --application-name faborchestratorai \
  --version-label v1 \
  --source-bundle S3Bucket=faborchestratorai-build-628203515088,S3Key=eb-deploy.zip \
  --region us-west-2
```

### Step 7: Create EB Environment

```bash
aws elasticbeanstalk create-environment \
  --application-name faborchestratorai \
  --environment-name faborchestratorai-prod \
  --version-label v1 \
  --solution-stack-name "64bit Amazon Linux 2023 v4.12.0 running Docker" \
  --option-settings \
    "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.large" \
    "Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=aws-elasticbeanstalk-ec2-role" \
    "Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=LoadBalanced" \
    "Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application" \
    "Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=aws-elasticbeanstalk-service-role" \
    "Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1" \
    "Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=2" \
    "Namespace=aws:elbv2:loadbalancer,OptionName=IdleTimeout,Value=600" \
    "Namespace=aws:ec2:vpc,OptionName=VPCId,Value=vpc-0521d5dc5d2554e5a" \
    'Namespace=aws:ec2:vpc,OptionName=Subnets,Value="subnet-06faf688f0ea464ac,subnet-0e0f6ddda096487f3,subnet-07a09ab450b741c55"' \
    'Namespace=aws:ec2:vpc,OptionName=ELBSubnets,Value="subnet-06faf688f0ea464ac,subnet-0e0f6ddda096487f3,subnet-07a09ab450b741c55"' \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_ENV,Value=production" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=HOSTNAME,Value=0.0.0.0" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=PORT,Value=3000" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_OPTIONS,Value=--max-old-space-size=6144" \
    "Namespace=aws:elasticbeanstalk:healthreporting:system,OptionName=SystemType,Value=enhanced" \
    "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=Port,Value=80" \
    "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=Protocol,Value=HTTP" \
    "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=StickinessEnabled,Value=true" \
    "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=StickinessLBCookieDuration,Value=600" \
  --region us-west-2
```

**Important:** The `process:default` Port MUST be `80` (Nginx), not `3000`. The ALB health checks target Nginx on port 80, which proxies to the Docker container on port 3000.

### Step 8: Wait for Environment Launch (~5-7 minutes)

```bash
# Check status (repeat until Status=Ready)
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,URL:CNAME}'
```

### Step 9: Set Sensitive Environment Variables

The environment must be in `Ready` state before updating:

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value=postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=KEY_ENCRYPTION_SECRET,Value=<KEY_ENCRYPTION_SECRET>" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ANTHROPIC_API_KEY,Value=sk-ant-api03-your-key-here" \
  --region us-west-2
```

### Step 10: Allow EB Instances to Access RDS

```bash
# Get the EB instance security group ID from the environment events or describe
# Then add inbound rule to the RDS security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-0af6fdeed5a3882f2 \
  --protocol tcp \
  --port 5432 \
  --source-group <EB-INSTANCE-SECURITY-GROUP-ID> \
  --region us-west-2
```

### Step 11: Verify Deployment

```bash
# Check health
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" \
  http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com/

# Test API
curl -s http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com/api/auth/me \
  -H "Authorization: Bearer test"
# Expected: {"error":"Invalid or expired session"}

# Verify ALB timeout
aws elbv2 describe-load-balancer-attributes \
  --load-balancer-arn $(aws elbv2 describe-load-balancers --region us-west-2 \
    --query 'LoadBalancers[?starts_with(LoadBalancerName, `awseb`)].LoadBalancerArn' --output text) \
  --region us-west-2 \
  --query 'Attributes[?Key==`idle_timeout.timeout_seconds`].Value' --output text
# Expected: 600
```

---

## Database Management

### Push Schema Changes

```bash
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
  npx prisma db push
```

### Run Migrations

```bash
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
  npx prisma migrate deploy
```

### Open Prisma Studio

```bash
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com:5432/claude_ai_athena" \
  npx prisma studio
```

### Connect via psql

```bash
PGPASSWORD=<DB_PASSWORD> psql \
  -h athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com \
  -U postgres -p 5432 \
  -d claude_ai_athena
```

---

## Monitoring & Logs

### Environment Status

```bash
# Current health and status
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,VersionLabel:VersionLabel,URL:CNAME}'
```

### Environment Events

```bash
# Recent events (deployments, health changes, errors)
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --max-items 20 \
  --query 'Events[*].{Time:EventDate,Severity:Severity,Message:Message}'

# Filter by severity
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --severity ERROR \
  --max-items 10
```

### Instance Logs (Tail)

```bash
# Request logs
aws elasticbeanstalk request-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type tail \
  --region us-west-2

# Wait a few seconds, then retrieve
sleep 10

# Get the pre-signed S3 URL
LOG_URL=$(aws elasticbeanstalk retrieve-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type tail \
  --region us-west-2 \
  --query 'EnvironmentInfo[0].Message' --output text)

# Download and view
curl -s "$LOG_URL" | tail -100
```

### Full Log Bundle

```bash
# Request full logs (includes nginx, docker, system logs)
aws elasticbeanstalk request-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type bundle \
  --region us-west-2

sleep 15

# Download zip
BUNDLE_URL=$(aws elasticbeanstalk retrieve-environment-info \
  --environment-name faborchestratorai-prod \
  --info-type bundle \
  --region us-west-2 \
  --query 'EnvironmentInfo[0].Message' --output text)

curl -s "$BUNDLE_URL" -o eb-logs.zip
unzip eb-logs.zip -d eb-logs/

# Key log files:
# eb-logs/var/log/eb-docker/containers/eb-current-app/*.log  — Application stdout/stderr
# eb-logs/var/log/nginx/access.log                           — Nginx access log
# eb-logs/var/log/nginx/error.log                            — Nginx error log
# eb-logs/var/log/eb-engine.log                              — EB platform engine
# eb-logs/var/log/docker-events.log                          — Docker events
```

### ALB Target Health

```bash
# Check if instances are healthy in the ALB target group
TG_ARN=$(aws elbv2 describe-target-groups --region us-west-2 \
  --query 'TargetGroups[?starts_with(TargetGroupName, `awseb`)].TargetGroupArn' --output text)

aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN \
  --region us-west-2
```

---

## Troubleshooting

### 502 Bad Gateway

**Cause:** ALB target group port is wrong, or Nginx can't reach the Docker container.

**Fix:** Ensure the ALB targets port 80 (Nginx), not port 3000 (Docker):
```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=Port,Value=80" \
  --region us-west-2
```

### Health Check Failures (Red Health)

**Cause:** Application not responding, usually missing DATABASE_URL or other env vars.

**Debug:**
```bash
# Check events for errors
aws elasticbeanstalk describe-events \
  --environment-name faborchestratorai-prod \
  --severity ERROR \
  --region us-west-2

# Check instance logs for application errors
# (use the log retrieval commands above)
```

### Docker Build Failures During Deployment

**Common causes:**
1. Docker Hub rate limiting — Dockerfile uses ECR public images to avoid this
2. TypeScript errors — run `npm run build` locally first
3. Missing files — ensure all required files are in the zip

### Database Connection Errors

**Cause:** EB security group not allowed in RDS security group.

**Fix:**
```bash
# Find EB instance security group
aws ec2 describe-security-groups --filters "Name=group-name,Values=*awseb*e-gdghmvt96r*" \
  --region us-west-2 --query 'SecurityGroups[*].GroupId'

# Add to RDS security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-0af6fdeed5a3882f2 \
  --protocol tcp --port 5432 \
  --source-group <EB-SG-ID> \
  --region us-west-2
```

### SSE Streaming Timeout

**Cause:** ALB idle timeout or Nginx proxy timeout too low.

**Verify:**
```bash
# Check ALB timeout (should be 600)
aws elbv2 describe-load-balancer-attributes \
  --load-balancer-arn $(aws elbv2 describe-load-balancers --region us-west-2 \
    --query 'LoadBalancers[?starts_with(LoadBalancerName, `awseb`)].LoadBalancerArn' --output text) \
  --region us-west-2 \
  --query 'Attributes[?Key==`idle_timeout.timeout_seconds`]'
```

### Out of Memory (OOM)

**Symptoms:** Instance becomes unhealthy, Docker container restarts.

**Fix:** Check if `NODE_OPTIONS` is set correctly:
```bash
aws elasticbeanstalk describe-configuration-settings \
  --application-name faborchestratorai \
  --environment-name faborchestratorai-prod \
  --region us-west-2 \
  --query 'ConfigurationSettings[0].OptionSettings[?OptionName==`NODE_OPTIONS`].Value'
```

If needed, upgrade instance type:
```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.xlarge" \
  --region us-west-2
```

---

## Scaling & Instance Configuration

### Change Instance Type

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.xlarge" \
  --region us-west-2
```

| Instance | RAM | vCPU | Cost/month | Good for |
|----------|-----|------|------------|----------|
| t3.medium | 4 GB | 2 | ~$30 | 1-3 concurrent users |
| t3.large | 8 GB | 2 | ~$60 | 5-10 concurrent users (current) |
| t3.xlarge | 16 GB | 4 | ~$120 | 10-20 concurrent users |

### Change Auto Scaling

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1" \
    "Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=4" \
  --region us-west-2
```

### Change ALB Timeout

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elbv2:loadbalancer,OptionName=IdleTimeout,Value=900" \
  --region us-west-2
```

Max allowed: 4000 seconds.

---

## HTTPS Setup (Optional)

To add HTTPS with an ACM certificate:

```bash
# 1. Request certificate (replace with your domain)
aws acm request-certificate \
  --domain-name your-domain.com \
  --validation-method DNS \
  --region us-west-2

# 2. Complete DNS validation, then add HTTPS listener
CERT_ARN="arn:aws:acm:us-west-2:628203515088:certificate/YOUR-CERT-ID"

aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --option-settings \
    "Namespace=aws:elbv2:listener:443,OptionName=Protocol,Value=HTTPS" \
    "Namespace=aws:elbv2:listener:443,OptionName=SSLCertificateArns,Value=$CERT_ARN" \
    "Namespace=aws:elbv2:listener:default,OptionName=ListenerEnabled,Value=true" \
  --region us-west-2
```

---

## Cost Estimates

| Service | Monthly Cost |
|---------|-------------|
| EC2 t3.large (1 instance) | ~$60 |
| ALB | ~$16 + $0.008/LCU-hr |
| S3 (deployment zips) | < $0.10 |
| RDS (shared, already running) | $0 incremental |
| CloudWatch Logs | < $1 |
| **Total** | **~$77/month** |

Scale down to `t3.medium` ($30/month) for lighter usage, reducing total to ~$47/month.

---

## Clean Up

### Delete EB Environment and Application

```bash
# 1. Terminate environment (takes ~5 minutes)
aws elasticbeanstalk terminate-environment \
  --environment-name faborchestratorai-prod \
  --region us-west-2

# 2. Wait for termination
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].Status'

# 3. Delete application (after environment is terminated)
aws elasticbeanstalk delete-application \
  --application-name faborchestratorai \
  --terminate-env-by-force \
  --region us-west-2
```

### Delete IAM Roles

```bash
# EC2 instance role
aws iam remove-role-from-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --role-name aws-elasticbeanstalk-ec2-role
aws iam delete-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role
aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier
aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker
aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier
aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam delete-role --role-name aws-elasticbeanstalk-ec2-role

# Service role
aws iam detach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam detach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy
aws iam delete-role --role-name aws-elasticbeanstalk-service-role
```

### Remove RDS Security Group Rule

```bash
aws ec2 revoke-security-group-ingress \
  --group-id sg-0af6fdeed5a3882f2 \
  --protocol tcp --port 5432 \
  --source-group sg-00476118d1f1cee71 \
  --region us-west-2
```

### Delete S3 Deployment Bucket (Optional)

```bash
aws s3 rb s3://faborchestratorai-build-628203515088 --force
```

### Drop Database (Optional)

```bash
PGPASSWORD=<DB_PASSWORD> psql \
  -h athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com \
  -U postgres -p 5432 \
  -c "DROP DATABASE claude_ai_athena;"
```

---

## Legacy: App Runner (Deprecated)

Previous deployment used AWS App Runner with a 120-second hard request timeout limit that cannot be increased. This caused network errors during long SSE streaming sessions.

| Item | Value |
|------|-------|
| **URL** | https://ppizczc9gc.us-west-2.awsapprunner.com |
| **Service ARN** | `arn:aws:apprunner:us-west-2:628203515088:service/llmatscale-ai/f51d99fc79bb412db69b64ae777a241b` |
| **Status** | Running (pending decommission) |

### Delete App Runner

```bash
aws apprunner delete-service \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/llmatscale-ai/f51d99fc79bb412db69b64ae777a241b \
  --region us-west-2

# Delete App Runner IAM roles
aws iam detach-role-policy --role-name apprunner-llmatscale-ai-ecr-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
aws iam delete-role --role-name apprunner-llmatscale-ai-ecr-role
aws iam delete-role --role-name apprunner-llmatscale-ai-instance-role
```
