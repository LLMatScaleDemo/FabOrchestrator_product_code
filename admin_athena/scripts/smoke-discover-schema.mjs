// Smoke test — verify on-prem DB credentials and count tables in a given schema,
// via the in-VPC discovery Lambda (the only path that reaches the on-prem SQL
// Server over the Site-to-Site VPN). Read-only: reads INFORMATION_SCHEMA only.
// Creates a TEMP secret from the creds file, invokes discovery, then deletes it.
//
//   node scripts/smoke-discover-schema.mjs ["<creds file>"] [schema]
//   defaults: "C:\\Users\\Jesus\\Downloads\\Sample DB Details.txt"  cammes
//
// Needs valid AWS creds in the environment (the static OTF_MCP keys) + region.
import { readFileSync } from 'node:fs';
import {
  SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand, DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const REGION = process.env.AWS_REGION || 'us-west-2';
const DISCOVERY_FN = process.env.MCP_OTF_DISCOVERY_FUNCTION || 'mcp-otf-discovery';
const SECRET_NAME = 'mcp/onthefly/smoke-discover';

const credsFile = process.argv[2] || 'C:\\Users\\Jesus\\Downloads\\Sample DB Details.txt';
const schema = process.argv[3] || 'cammes';

// Parse the SQL-login creds from the file (the "SQL Connection" section wins).
const txt = readFileSync(credsFile, 'utf8');
const host = (txt.match(/Server IP:\s*([^\s\r\n]+)/i) || txt.match(/Host:\s*([^\s\r\n]+)/i))?.[1];
const sqlPart = txt.split(/SQL Connection/i)[1] || txt;
const database = (sqlPart.match(/Datab?a?se Name:\s*([^\s\r\n]+)/i) || txt.match(/Datab?a?se Name:\s*([^\s\r\n]+)/i))?.[1];
const user = sqlPart.match(/Username:\s*([^\s\r\n]+)/i)?.[1];
const password = sqlPart.match(/Password:\s*([^\s\r\n]+)/i)?.[1];
if (!host || !database || !user || !password) {
  console.error('could not parse creds from', credsFile, { host: !!host, database: !!database, user: !!user, password: !!password });
  process.exit(1);
}
console.log(`target: ${host}  db: ${database}  user: ${user}  schema: ${schema}  (password hidden)`);
const creds = { host, port: 1433, user, password, database };

const sm = new SecretsManagerClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

let secretArn;
try {
  secretArn = (await sm.send(new CreateSecretCommand({
    Name: SECRET_NAME, SecretString: JSON.stringify(creds), Tags: [{ Key: 'feature', Value: 'mcp-onthefly' }],
  }))).ARN;
} catch (e) {
  if (e.name === 'ResourceExistsException') {
    await sm.send(new PutSecretValueCommand({ SecretId: SECRET_NAME, SecretString: JSON.stringify(creds) }));
    secretArn = SECRET_NAME;
  } else { console.error('secret error:', e.name, e.message); process.exit(2); }
}

async function discover(schemas) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: DISCOVERY_FN, InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ secretArn, engine: 'sqlserver', schemas })),
  }));
  if (res.FunctionError) return { ok: false, error: `FunctionError ${res.FunctionError}` };
  return JSON.parse(Buffer.from(res.Payload).toString('utf8'));
}

try {
  console.log(`\n[schema='${schema}'] invoking discovery Lambda '${DISCOVERY_FN}' over the VPN (cold start can take ~30-60s)...`);
  const one = await discover([schema]);
  if (!one.ok) {
    console.log('  ❌ DISCOVERY FAILED:', one.error, '\n  (creds may be wrong, or the schema does not exist / is unreachable)');
  } else {
    const disc = one.discovered ?? one.tables.length;
    console.log(`  ✅ credentials OK. Schema '${schema}': discovered ${disc} tables, returned ${one.tables.length}` + (one.truncated ? ` (selected the ${one.tables.length} most relevant of ${disc})` : ' (all)'));
    console.log('  sample of returned:', one.tables.slice(0, 20).map((t) => t.table).join(', '));
    console.log(`  total columns across returned tables: ${one.tables.reduce((s, t) => s + t.columns.length, 0)}`);
  }

  console.log('\n[all schemas] for comparison...');
  const all = await discover([]);
  if (all.ok) {
    const bySchema = {};
    for (const t of all.tables) bySchema[t.schema] = (bySchema[t.schema] || 0) + 1;
    console.log(`  discovered ${all.discovered ?? '?'} tables, returned ${all.tables.length}${all.truncated ? ' (truncated to the byte/table budget)' : ''}`);
    console.log('  by schema (of returned):', Object.entries(bySchema).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join(', '));
  } else {
    console.log('  failed:', all.error);
  }
} finally {
  await sm.send(new DeleteSecretCommand({ SecretId: SECRET_NAME, ForceDeleteWithoutRecovery: true })).catch(() => {});
  console.log('\n(temp smoke secret deleted)');
}
