# CMF token Lambda (Postgres-writing)

Single code **template** for every CMF connection's token refresher. Mints the MES
API JWT via headless Chromium (portal login) and **UPSERTs it into the Postgres
`cmf_bearer_tokens` table** (the app's source of truth), keyed by `TOKEN_DB_NAME`.
Only the **env inputs** change per connection; the **45-min schedule is identical**.

## Files
- `index.mjs` — handler: mint → write to Postgres (primary) → optional Secrets Manager dual-write.
- `get-cmf-token.mjs` — **unchanged** from the current Lambdas (Playwright + `@sparticuz/chromium` portal login). Copy it from the existing artifact when packaging.

## Env vars
| var | scope | example |
|-----|-------|---------|
| `CMF_BASE_URL` | per connection | `https://atscmapp4.usa.athenatec.com` |
| `CMF_USER` | per connection | `ATHENATEC\atscmapp4` (portal domain acct) |
| `CMF_PASS` | per connection | (portal password) |
| `HOST_RESOLVER` | per connection | `atscmapp4.usa.athenatec.com=10.10.1.224` |
| `DATABASE_URL` | **shared** (same for all) | the RDS Postgres URL |
| `TOKEN_DB_NAME` | per connection | `EntegrisKSPUpgrade` / `CriticalManufacturing` |
| `CMF_TOKEN_SECRET_ID` | optional (migration) | `cmf/portal-token-entegris-224` — dual-write; remove once DB proven |

## Packaging
Same bundle shape as the current Lambdas, plus `pg`:
1. Start from the existing Lambda zip (has `@sparticuz/chromium`, `playwright-core`, `@aws-sdk/client-secrets-manager` in `node_modules/`).
2. `npm i pg` into `node_modules/` (adds `pg` + `pg-*` deps).
3. Replace `index.mjs` with this one; keep `get-cmf-token.mjs`.
4. Zip at root (`index.mjs`, `get-cmf-token.mjs`, `node_modules/`, `package.json`).

## Deploy — Stage A (update the 2 EXISTING Lambdas)
For `cmf-portal-token-entegris-224` (source) and `CMF-OOB` (target):
1. `aws lambda update-function-code --function-name <fn> --zip-file fileb://cmf-token.zip` (or via S3 for the ~30 MB artifact).
2. Add env `DATABASE_URL` + `TOKEN_DB_NAME` (source→`EntegrisKSPUpgrade`, target→`CriticalManufacturing`); keep existing `CMF_TOKEN_SECRET_ID` for dual-write.
3. Keep the existing VPC (subnet-050098578f3a0fbad / sg-0299b94298e64e570), role `feb-orc-mcp-lambda-role`, and `rate(45 min)` schedule.
4. Invoke once to seed: `aws lambda invoke --function-name <fn> /dev/stdout` → expect `{ ok: true, dbName, expiresAt }`; verify a `cmf_bearer_tokens` row appears.

## Deploy — Stage C (provision a NEW Lambda per connection, from the admin app)
Artifact stored once in S3. On connection create: `CreateFunction` from the S3
artifact with the per-connection env above + shared `DATABASE_URL`, VPC, role;
then create a `rate(45 min)` EventBridge rule + target + `lambda:AddPermission`;
invoke once to seed. Store the created `lambda_arn` + `schedule_name` on the
connection row for teardown on delete.

## Notes
- RDS is publicly accessible and its SG allows 5432 from `0.0.0.0/0`; the Lambda VPC already egresses to AWS (Secrets Manager today), so the public RDS endpoint is reachable. `ssl:false` matches the app's POC config.
- The portal password lives in the Lambda's env (as it does today). If that posture changes, encrypt it and decrypt in-Lambda.
