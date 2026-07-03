# NexusOps AI - Deployment Guide

## AWS Account

- **Account ID:** 628203515088
- **Region:** us-west-2 (Oregon)
- **IAM User:** danish

## AWS Services Created

| Service | Resource Name | Purpose |
|---------|-------------|---------|
| ECR | `nexusops-ai` | Docker image registry |
| S3 | `nexusops-ai-build-628203515088` | Source code for CodeBuild |
| CodeBuild | `nexusops-ai-build` | Builds Docker image from source |
| App Runner | `nexusops-ai` | Runs the application |
| RDS | `athena-poc-db` (shared, pre-existing) | PostgreSQL database |

## App URL

**https://f2yrpmdeqx.us-west-2.awsapprunner.com**

## Environment Variables (App Runner)

| Variable | Value |
|----------|-------|
| NODE_ENV | development |
| DATABASE_URL | postgresql://...athena-poc-db.../ai_chatbot_dev |
| ANTHROPIC_API_KEY | sk-ant-api03-... |
| KEY_ENCRYPTION_SECRET | a1b2c3d4... |
| APP_URL | https://f2yrpmdeqx.us-west-2.awsapprunner.com |
| SMTP_SERVER | smtp.gmail.com |
| SMTP_PORT | 587 |
| SMTP_USERNAME | admin@llmatscale.ai |
| SMTP_FROM_EMAIL | admin@llmatscale.ai |
| ENABLE_MCP | true |
| ROOT_DOMAIN | llmatscale.ai |

## Deployment Steps

### Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Access to the `628203515088` AWS account

### Step 1: Zip the source code

```powershell
$source = 'C:\Users\danis\Documents\Claude_ai-master'
$dest = 'C:\Users\danis\nexusops-source.zip'
if (Test-Path $dest) { Remove-Item $dest }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($dest, 'Create')
$excludeDirs = @('node_modules','.next','.git','.claude','.planning','deploy')
$files = Get-ChildItem -Path $source -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($source.Length + 1)
    $skip = $false
    foreach ($d in $excludeDirs) { if ($rel.StartsWith($d + '\')) { $skip = $true; break } }
    -not $skip
}
foreach ($f in $files) {
    $entry = $f.FullName.Substring($source.Length + 1).Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry) | Out-Null
}
$zip.Dispose()
```

### Step 2: Upload to S3

```bash
aws s3 cp nexusops-source.zip s3://nexusops-ai-build-628203515088/source.zip --region us-west-2
```

### Step 3: Trigger CodeBuild

```bash
aws codebuild start-build --project-name nexusops-ai-build --region us-west-2
```

### Step 4: Check build status

```bash
aws codebuild batch-get-builds --ids <BUILD_ID> --region us-west-2 --query 'builds[0].buildStatus'
```

Wait until status is `SUCCEEDED` (~5-6 minutes).

### Step 5: Deploy to App Runner

```bash
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2
```

### Step 6: Verify deployment

```bash
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2 \
  --query 'Service.{status:Status,url:ServiceUrl}'
```

Wait until status is `RUNNING` (~2-3 minutes).

## Quick Deploy (All Steps)

```bash
# 1. Zip (run PowerShell script above)

# 2. Upload + Build + Deploy
aws s3 cp nexusops-source.zip s3://nexusops-ai-build-628203515088/source.zip --region us-west-2
aws codebuild start-build --project-name nexusops-ai-build --region us-west-2
# Wait ~5 min for build to complete
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2
# Wait ~2 min, then verify at https://f2yrpmdeqx.us-west-2.awsapprunner.com
```

## Updating Environment Variables

Edit `deploy/update-service.json` and run:

```bash
aws apprunner update-service \
  --service-arn arn:aws:apprunner:us-west-2:628203515088:service/nexusops-ai/67cbe6f933684d44bce107854fe5ef67 \
  --region us-west-2 \
  --source-configuration file://deploy/update-service.json
```

## Database

- **Host:** athena-poc-db.cb0i6mi8cbg1.us-west-2.rds.amazonaws.com
- **Database:** ai_chatbot_dev
- **Port:** 5432

### Seed database (first time only)

```bash
npm run db:push
npm run db:seed
```

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Build fails at DOWNLOAD_SOURCE | Check S3 bucket permissions for CodeBuild role |
| Build fails at docker build | Check Dockerfile and ensure all files are in zip |
| App Runner stuck in OPERATION_IN_PROGRESS | Wait 3-5 min, it will resolve |
| Invite emails have wrong URL | Verify `APP_URL` env var is set in App Runner |
| Login says "Something went wrong" | Check `DATABASE_URL` points to correct database |
