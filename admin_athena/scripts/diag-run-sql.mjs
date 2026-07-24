// Diagnostic — deploy a THROWAWAY mssql Lambda into the CMF VPC that runs
// arbitrary READ-ONLY SQL and returns the RAW error (the real runtime masks DB
// errors as "internal error executing query", hiding the cause). Reuses an
// existing data source's stored secret. Probes the maintenance/products tools to
// tell "empty table" apart from "broken SQL". Deletes the function when done.
//
//   node scripts/diag-run-sql.mjs ["<name like>"]     (default "%OPC%")
import { readFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import AdmZip from 'adm-zip';
import { LambdaClient, CreateFunctionCommand, GetFunctionConfigurationCommand, DeleteFunctionCommand, InvokeCommand } from '@aws-sdk/client-lambda';

const REGION = 'us-west-2';
const ROLE = 'arn:aws:iam::628203515088:role/mcp-otf-runtime-exec';
const CMF_SUBNETS = ['subnet-0cfc26eb17af33330', 'subnet-03de8d1716947ddfb'];
const CMF_SG = 'sg-0dc3bdccf1d97f2c3';
const NAME = 'mcp-otf-diag';
const nameLike = process.argv[2] || '%OPC%';

// Raw diagnostic handler — runs event.sql with event.params, returns rows OR the raw error.
const DIAG_HANDLER = `
import sql from 'mssql';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-west-2' });
let pool = null;
async function getPool() {
  if (pool) return pool;
  const s = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }))).SecretString);
  pool = await new sql.ConnectionPool({ server: s.host, database: s.database, user: s.user, password: s.password,
    options: { instanceName: s.instance || undefined, encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 45000, requestTimeout: 45000, ...(s.instance ? {} : { port: Number(s.port) || 1433 }) }).connect();
  return pool;
}
export const handler = async (event) => {
  try {
    const p = await getPool();
    const req = p.request();
    for (const x of (event.params || [])) req.input(x.name, x.value);
    const rs = await req.query(event.sql);
    return { ok: true, rowCount: (rs.recordset || []).length, sample: (rs.recordset || []).slice(0, 3) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
};
`;

// ── read the deployed manifest to get the real product/maintenance SQL ──
const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const url = new URL(env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)[1]);
const { address: host } = await dns.lookup(url.hostname, { family: 4 });
const pgc = new pg.Client({ host, port: +(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), ssl: false });
await pgc.connect();
const rr = await pgc.query(`select secret_arn, manifest from mcp_data_sources where name ilike $1 and status='ACTIVE' order by updated_at desc limit 1`, [nameLike]);
await pgc.end();
const secretArn = rr.rows[0]?.secret_arn;
const tools = rr.rows[0]?.manifest?.tools || [];
if (!secretArn) { console.error('no secret'); process.exit(2); }
const noParams = (s) => s.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, 'NULL'); // strip named params → all filters off
const prod = tools.find((t) => /product/i.test(t.name));
const maint = tools.find((t) => /maint/i.test(t.name));

// ── probes ──
const probes = [
  ['count Product', 'SELECT COUNT(*) AS n FROM [cammes].[Product]', []],
  ['Product.IsAvailable sample', 'SELECT TOP (5) [ProductName],[IsAvailable] FROM [cammes].[Product]', []],
  ['products tool (no filters)', noParams(prod.sql), []],
  ['products filter IsAvailable = string "true"', 'SELECT COUNT(*) AS n FROM [cammes].[Product] WHERE [IsAvailable] = @v', [{ name: 'v', value: 'true' }]],
  ['products filter IsAvailable = 1', 'SELECT COUNT(*) AS n FROM [cammes].[Product] WHERE [IsAvailable] = @v', [{ name: 'v', value: 1 }]],
  ['count MaintenanceStatus', 'SELECT COUNT(*) AS n FROM [cammes].[MaintenanceStatus]', []],
  ['count MaintenanceReq', 'SELECT COUNT(*) AS n FROM [cammes].[MaintenanceReq]', []],
  ['maintenance tool (no filters)', noParams(maint.sql), []],
];

// ── deploy diag lambda ──
const zip = new AdmZip(readFileSync(join(here, '..', 'mcp-onthefly', 'runtime-base-v1-mssql.zip')));
zip.addFile('index.mjs', Buffer.from(DIAG_HANDLER));           // replace handler with the raw one
zip.addFile('manifest.json', Buffer.from('{"tools":[]}'));      // unused, keep loader happy
const lambda = new LambdaClient({ region: REGION });
try { await lambda.send(new DeleteFunctionCommand({ FunctionName: NAME })); await new Promise((r) => setTimeout(r, 4000)); } catch { /* none */ }
await lambda.send(new CreateFunctionCommand({
  FunctionName: NAME, Runtime: 'nodejs20.x', Handler: 'index.handler', Role: ROLE,
  Code: { ZipFile: zip.toBuffer() }, Timeout: 60, MemorySize: 256,
  VpcConfig: { SubnetIds: CMF_SUBNETS, SecurityGroupIds: [CMF_SG] },
  Environment: { Variables: { SECRET_ARN: secretArn } }, Tags: { feature: 'mcp-onthefly' },
}));
console.log('diag lambda creating (ENI ~30-60s)...');
let state = 'Pending';
for (let i = 0; i < 30 && state !== 'Active'; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const c = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: NAME }));
  state = c.State;
  if (state === 'Failed') { console.error('failed:', c.StateReason); process.exit(3); }
}

async function run(sql, params) {
  const res = await lambda.send(new InvokeCommand({ FunctionName: NAME, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ sql, params })) }));
  return JSON.parse(Buffer.from(res.Payload).toString('utf8'));
}
try {
  for (const [label, sqlText, params] of probes) {
    const out = await run(sqlText, params);
    if (out.ok) console.log(`\n✅ ${label}: rowCount=${out.rowCount} | sample=${JSON.stringify(out.sample).slice(0, 300)}`);
    else console.log(`\n❌ ${label}: ERROR = ${out.error}`);
  }
} finally {
  await lambda.send(new DeleteFunctionCommand({ FunctionName: NAME })).catch(() => {});
  console.log('\n(diag lambda deleted)');
}
