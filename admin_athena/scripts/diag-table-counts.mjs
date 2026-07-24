// Diagnostic — get real row counts (and a tiny sample) for specific on-prem
// tables, to tell "the tool's SQL is wrong" apart from "the table is empty".
// Reuses an existing data source's stored secret, deploys a THROWAWAY mssql
// runtime with COUNT/sample tools into the CMF VPC, invokes it via IAM, then
// deletes the function. Read-only (SELECT COUNT / SELECT TOP).
//
//   node scripts/diag-table-counts.mjs "<name like>" <schema> <table> [table...]
//   e.g. node scripts/diag-table-counts.mjs "%OPC%" cammes MaintenanceStatus MaintenanceReq ResourceDef
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
const schema = process.argv[3] || 'cammes';
const tables = process.argv.slice(4);
if (!tables.length) { console.error('usage: node scripts/diag-table-counts.mjs "<name like>" <schema> <table> [table...]'); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const url = new URL(env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)[1]);
const { address: host } = await dns.lookup(url.hostname, { family: 4 });
const pgc = new pg.Client({ host, port: +(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), ssl: false });
await pgc.connect();
const r = await pgc.query(`select secret_arn from mcp_data_sources where name ilike $1 and secret_arn is not null order by updated_at desc limit 1`, [nameLike]);
await pgc.end();
const secretArn = r.rows[0]?.secret_arn;
if (!secretArn) { console.error('no secret_arn found for', nameLike); process.exit(2); }

const tools = [];
for (const t of tables) {
  tools.push({ name: `count_${t}`, description: `count`, inputSchema: { type: 'object', properties: {} }, sql: `SELECT COUNT(*) AS n FROM [${schema}].[${t}]` });
  tools.push({ name: `sample_${t}`, description: `sample`, inputSchema: { type: 'object', properties: {} }, sql: `SELECT TOP (3) * FROM [${schema}].[${t}]` });
}
const zip = new AdmZip(readFileSync(join(here, '..', 'mcp-onthefly', 'runtime-base-v1-mssql.zip')));
zip.addFile('manifest.json', Buffer.from(JSON.stringify({ server: 'diag', tools })));
const bearer = randomBytes(24).toString('hex');
const lambda = new LambdaClient({ region: REGION });

try { await lambda.send(new DeleteFunctionCommand({ FunctionName: NAME })); await new Promise((r) => setTimeout(r, 4000)); } catch { /* none */ }
await lambda.send(new CreateFunctionCommand({
  FunctionName: NAME, Runtime: 'nodejs20.x', Handler: 'index.handler', Role: ROLE,
  Code: { ZipFile: zip.toBuffer() }, Timeout: 30, MemorySize: 256,
  VpcConfig: { SubnetIds: CMF_SUBNETS, SecurityGroupIds: [CMF_SG] },
  Environment: { Variables: { SECRET_ARN: secretArn, MCP_BEARER_TOKEN: bearer, MAX_ROWS: '50' } },
  Tags: { feature: 'mcp-onthefly' },
}));
console.log('diag runtime creating in CMF VPC (ENI ~30-60s)...');
let state = 'Pending';
for (let i = 0; i < 30 && state !== 'Active'; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const c = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: NAME }));
  state = c.State;
  if (state === 'Failed') { console.error('failed:', c.StateReason); process.exit(3); }
}
if (state !== 'Active') { console.error('not Active in time'); process.exit(4); }

async function call(name) {
  const event = { requestContext: { http: { method: 'POST' } }, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }), isBase64Encoded: false };
  const res = await lambda.send(new InvokeCommand({ FunctionName: NAME, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(event)) }));
  const raw = JSON.parse(Buffer.from(res.Payload).toString('utf8'));
  const body = JSON.parse(raw.body);
  return body?.result?.content?.[0]?.text || JSON.stringify(body);
}

try {
  for (const t of tables) {
    const cnt = await call(`count_${t}`);
    console.log(`\n[${schema}.${t}] count = ${cnt}`);
    const s = await call(`sample_${t}`);
    console.log('  sample:', s.slice(0, 400));
  }
} finally {
  await lambda.send(new DeleteFunctionCommand({ FunctionName: NAME })).catch(() => {});
  console.log('\n(diag runtime deleted)');
}
