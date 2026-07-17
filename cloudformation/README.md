# CloudFormation — FabOrchestrator + Fab Admin App

Infrastructure as **CloudFormation**, replacing the Terraform in `terraform/`.
Chosen because the stack is **AWS-only**: CloudFormation runs on the **AWS CLI
you already have** (no Terraform binary / Docker / S3 state bucket), and AWS
manages the state.

```
cloudformation/
├── networking.yaml        # CMF VPC subnets, egress SG, peering, routes, RDS ingress   → reference *
├── iam.yaml               # cmf-loader-access (S3 + Secrets Manager) as a managed policy → DEPLOYED ✅
├── elasticbeanstalk.yaml  # Fab (CMF VPC) + Admin EB app/env definitions               → reference **
└── cloudfront-admin.yaml  # Admin HTTPS distribution (E3DEL8WM533ECX)                    → IMPORTED ✅
```

**4 stacks**, split by concern (independent deploy / rollback / cadence). Region
`us-west-2`, account `628203515088`.

### Migration status (what's actually under CloudFormation)

| Stack | Status | Notes |
|-------|--------|-------|
| `faborch-admin-cloudfront` | **live — imported** | owns distribution `E3DEL8WM533ECX` (DeletionPolicy: Retain) |
| `faborch-iam` | **live — deployed** | managed policy `cmf-loader-access`; the old inline policy was removed |
| networking.yaml | **reference only** | * mixes importable (subnet/SG/peering) with **non-importable** types (`AWS::EC2::Route`, `AWS::EC2::SecurityGroupIngress`); an IMPORT change set needs *every* resource importable, so the live networking stays as-is. Template creates it fresh in a new account/region. |
| elasticbeanstalk.yaml | **reference only** | ** live EB envs are EB-managed CFN stacks — can't be imported. For new/replacement envs. |

---

## Two ways to use a template

- **Create** (new/other account or region): `aws cloudformation deploy` (or
  `create-stack`). Provisions fresh resources.
- **Import** (adopt an *existing* resource into a stack, no recreation):
  `create-change-set --change-set-type IMPORT` with a resources-to-import map,
  then `execute-change-set`. Import never modifies the resource — a mismatch just
  fails the change set, so it's safe to iterate.

Validate any template first:
```bash
aws cloudformation validate-template --template-body file://cloudformation/networking.yaml --region us-west-2
```

---

## Stack 1 — networking.yaml (IMPORT the live resources)

Adopts the CMF networking that already exists. Logical → physical mapping:

| Logical id | Type | Physical id |
|-----------|------|-------------|
| `AppSubnetA` | AWS::EC2::Subnet | `subnet-0cfc26eb17af33330` |
| `AppSubnetB` | AWS::EC2::Subnet | `subnet-03de8d1716947ddfb` |
| `AppEgressSecurityGroup` | AWS::EC2::SecurityGroup | `sg-0dc3bdccf1d97f2c3` |
| `RdsPeeringConnection` | AWS::EC2::VPCPeeringConnection | *(get from `describe-vpc-peering-connections`)* |
| `AppSubnet{A,B}Association`, `AppToSharedRoute`, `SharedToAppRoute`, `RdsIngressFromSubnet{A,B}` | route/SG rules | *(see notes below)* |

```bash
# resources-to-import.json  (one object per importable resource)
# [{ "ResourceType":"AWS::EC2::Subnet","LogicalResourceId":"AppSubnetA","ResourceIdentifier":{"SubnetId":"subnet-0cfc26eb17af33330"} }, … ]

aws cloudformation create-change-set --region us-west-2 \
  --stack-name faborch-networking --change-set-name import-net --change-set-type IMPORT \
  --template-body file://cloudformation/networking.yaml \
  --resources-to-import file://resources-to-import.json \
  --parameters ParameterKey=SharedVpcCidr,ParameterValue=<shared-cidr> \
               ParameterKey=SharedRouteTableId,ParameterValue=<shared-rtb>
aws cloudformation execute-change-set --region us-west-2 \
  --stack-name faborch-networking --change-set-name import-net
```

Post-import (no CFN equivalent): re-assert DNS-over-peering —
`aws ec2 modify-vpc-peering-connection-options … --requester/accepter-peering-connection-options AllowDnsResolutionFromRemoteVpc=true`.

> `SharedVpcCidr` and `SharedRouteTableId` are **required parameters** (no
> defaults) — look them up:
> `aws ec2 describe-vpcs --vpc-ids vpc-0521d5dc5d2554e5a --query 'Vpcs[0].CidrBlock'`.
> Not every rule/route/association is directly importable; if a change set
> rejects one, create it fresh in the stack instead (or leave it out — it
> already exists and works).

## Stack 2 — iam.yaml

`cmf-loader-access` modelled as an **`AWS::IAM::ManagedPolicy`** attached to
`aws-elasticbeanstalk-ec2-role` (inline role policies aren't importable in CFN).
Deploy it, then remove the old inline grant:
```bash
aws cloudformation deploy --region us-west-2 --stack-name faborch-iam \
  --template-file cloudformation/iam.yaml --capabilities CAPABILITY_NAMED_IAM
aws iam delete-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-name cmf-loader-access
```

## Stack 3 — elasticbeanstalk.yaml (reference / create-new only)

> ⚠️ **The live EB environments cannot be imported.** `faborchestratorai-cmf`,
> `faborchestratorai-prod`, and `fab-admin-prod` are each already backed by their
> own EB-managed CloudFormation stack (`awseb-e-…-stack`). This template exists
> for **parity with the old Terraform** and for creating **new/replacement**
> environments. Do not try to import the current ones.

Deploy a NEW env (e.g. staging), toggling the `Create*` conditions:
```bash
aws cloudformation deploy --region us-west-2 --stack-name faborch-eb \
  --template-file cloudformation/elasticbeanstalk.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides CreateApplication=false CreateFabEnv=true CreateAdminEnv=false
```
> ⚠️ Admin `PORT=3001` (container `EXPOSE 3001`); Fab `PORT=3000`. `process:default`
> Port stays 80 (Nginx). Wrong admin PORT → HTTP 502.

## Stack 4 — cloudfront-admin.yaml (IMPORT)

Adopts the admin HTTPS distribution:
```bash
# [{ "ResourceType":"AWS::CloudFront::Distribution","LogicalResourceId":"AdminDistribution","ResourceIdentifier":{"Id":"E3DEL8WM533ECX"} }]
aws cloudformation create-change-set --region us-west-2 \
  --stack-name faborch-admin-cloudfront --change-set-name import-cf --change-set-type IMPORT \
  --template-body file://cloudformation/cloudfront-admin.yaml \
  --resources-to-import file://cf-import.json
aws cloudformation execute-change-set --region us-west-2 \
  --stack-name faborch-admin-cloudfront --change-set-name import-cf
```

---

## Secrets / env vars

Templates carry **non-secret** env vars only. Set secrets on the EB environment
out of band (they never enter a template or CloudFormation state):
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `KEY_ENCRYPTION_SECRET`, `CMF_SQL_*`,
`CMF_BASE_URL`, `HOST_RESOLVER`, `CMF_TOKEN_*`, `S3_BUCKET`/`S3_UPLOAD_BUCKET`,
`SMTP_*`, `ADMIN_*`. See each app's `DEPLOYMENT.md`.

## Recommended order

1. `validate-template` all four.
2. Import **networking** and **cloudfront**, deploy **iam**.
3. Keep **elasticbeanstalk.yaml** as the reference for new envs.
4. Once satisfied, delete `terraform/` (or keep as historical reference) and its
   state bucket/lock table.

## App deploys are unchanged

CloudFormation manages *infrastructure*. Shipping app code is still the
CLI flow in each `DEPLOYMENT.md` (`zip → S3 → create-application-version →
update-environment`) — no CloudFormation involved.
