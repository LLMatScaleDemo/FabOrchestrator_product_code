// Isolated CMF-VPC smoke test for the SQL Server runtime.
// Reads the Opcenter creds from the sample file, deploys ONE mssql runtime Lambda
// into the CMF VPC, and calls it (initialize / tools/list / tools/call) to list the
// cammes tables over the Site-to-Site VPN. Proves the on-prem path end-to-end.
//
//   AWS_PROFILE=mcp-otf-deployer node scripts/smoke-cmf-mssql.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import { SecretsManagerClient, CreateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { LambdaClient, CreateFunctionCommand, GetFunctionConfigurationCommand, CreateFunctionUrlConfigCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';

const REGION = 'us-west-2';
const ROLE = 'arn:aws:iam::628203515088:role/mcp-otf-runtime-exec';
const CMF_SUBNETS = ['subnet-0cfc26eb17af33330', 'subnet-03de8d1716947ddfb'];
const CMF_SG = 'sg-0dc3bdccf1d97f2c3';
const NAME = 'mcp-otf-opcenter-smoke';
const SECRET_NAME = 'mcp/onthefly/opcenter-smoke';

// 1) parse creds from the sample file (SQL Connection section)
const detailsPath = 'C:\\Users\\Jesus\\Downloads\\Sample DB Details.txt';
const txt = readFileSync(detailsPath, 'utf8');
const host = txt.match(/Server IP:\s*([^\s\r\n]+)/i)?.[1];
const sqlPart = txt.split(/SQL Connection/i)[1] || txt;
const database = (sqlPart.match(/Datab?a?se Name:\s*([^\s\r\n]+)/i) || txt.match(/Datab?a?se Name:\s*([^\s\r\n]+)/i))?.[1];
const user = sqlPart.match(/Username:\s*([^\s\r\n]+)/i)?.[1];
const password = sqlPart.match(/Password:\s*([^\s\r\n]+)/i)?.[1];
if (!host || !database || !user || !password) { console.error('could not parse creds:', { host: !!host, database: !!database, user: !!user, password: !!password }); process.exit(1); }
console.log(`target: ${host}:1433  db: ${database}  user: ${user}  (password hidden)`);
const creds = { host, port: 1433, user, password, database };

// 2) store the secret
const sm = new SecretsManagerClient({ region: REGION });
let secretArn;
try {
  secretArn = (await sm.send(new CreateSecretCommand({ Name: SECRET_NAME, SecretString: JSON.stringify(creds), Tags: [{ Key: 'feature', Value: 'mcp-onthefly' }] }))).ARN;
  console.log('secret created');
} catch (e) {
  if (e.name === 'ResourceExistsException') { console.log('secret already exists — reusing'); secretArn = `arn:aws:secretsmanager:${REGION}:628203515088:secret:${SECRET_NAME}`; }
  else { console.error('CreateSecret failed:', e.name, e.message); process.exit(2); }
}

// 3) build deployment zip = base mssql runtime + smoke manifest
const here = dirname(fileURLToPath(import.meta.url));
const zip = new AdmZip(readFileSync(join(here, '..', 'mcp-onthefly', 'runtime-base-v1-mssql.zip')));
const manifest = { server: 'opcenter-smoke', tools: [{ name: 'list_tables', description: 'List tables in a schema', inputSchema: { type: 'object', properties: { schema: { type: 'string' } }, required: ['schema'] }, sql: 'SELECT TOP (50) TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :schema ORDER BY TABLE_NAME' }] };
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));

// 4) create the Lambda in the CMF VPC
const bearer = randomBytes(24).toString('hex');
const lambda = new LambdaClient({ region: REGION });
try {
  await lambda.send(new CreateFunctionCommand({
    FunctionName: NAME, Runtime: 'nodejs20.x', Handler: 'index.handler', Role: ROLE,
    Code: { ZipFile: zip.toBuffer() }, Timeout: 30, MemorySize: 256,
    VpcConfig: { SubnetIds: CMF_SUBNETS, SecurityGroupIds: [CMF_SG] },
    Environment: { Variables: { SECRET_ARN: secretArn, MCP_BEARER_TOKEN: bearer, MAX_ROWS: '50' } },
    Tags: { feature: 'mcp-onthefly' },
  }));
  console.log('function creating (VPC ENI setup ~30-60s)...');
} catch (e) { console.error('CreateFunction failed:', e.name, e.message); process.exit(3); }

// wait for Active
let state = 'Pending';
for (let i = 0; i < 30 && state !== 'Active'; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const c = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: NAME }));
  state = c.State;
  console.log(`  state=${state} ${c.StateReasonCode || ''}`);
  if (state === 'Failed') { console.error('function failed:', c.StateReason); process.exit(4); }
}
if (state !== 'Active') { console.error('function not Active in time'); process.exit(5); }

// 5) function URL
const url = (await lambda.send(new CreateFunctionUrlConfigCommand({ FunctionName: NAME, AuthType: 'NONE' }))).FunctionUrl;
await lambda.send(new AddPermissionCommand({ FunctionName: NAME, StatementId: 'url', Action: 'lambda:InvokeFunctionUrl', Principal: '*', FunctionUrlAuthType: 'NONE' }));
console.log('function URL ready:', url);
await new Promise((r) => setTimeout(r, 6000));

// 6) drive the MCP protocol
async function rpc(method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(45000) });
  return { status: res.status, body: await res.text() };
}
console.log('\n--- initialize ---'); console.log((await rpc('initialize', {})).body);
console.log('\n--- tools/list ---'); console.log((await rpc('tools/list', {})).body);
console.log('\n--- tools/call list_tables {schema:"cammes"} (queries on-prem over the VPN) ---');
const call = await rpc('tools/call', { name: 'list_tables', arguments: { schema: 'cammes' } });
console.log('HTTP', call.status); console.log(call.body);

console.log('\nCleanup when done:');
console.log(`  aws lambda delete-function --function-name ${NAME} --profile mcp-otf-deployer --region ${REGION}`);
console.log(`  aws secretsmanager delete-secret --secret-id ${SECRET_NAME} --force-delete-without-recovery --profile mcp-otf-deployer --region ${REGION}`);
