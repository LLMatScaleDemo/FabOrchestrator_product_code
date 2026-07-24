/**
 * On-the-Fly MCP — invoke the shared discovery Lambda (in the CMF VPC) to read a
 * target's schema from INSIDE the VPC. This is how discovery works for targets the
 * admin app can't reach directly (on-prem SQL Server, in-VPC Postgres). The creds
 * never leave AWS — the Lambda reads them from Secrets Manager by ARN.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { DiscoveryResult } from './connectivity';

const REGION = process.env.AWS_REGION || 'us-west-2';
const FUNCTION = process.env.MCP_OTF_DISCOVERY_FUNCTION || 'mcp-otf-discovery';

let _lambda: LambdaClient | null = null;
const lambda = () => (_lambda ??= new LambdaClient({ region: REGION }));

export interface DiscoverViaLambdaResult { ok: boolean; tables?: DiscoveryResult['tables']; error?: string }

/** Invoke the discovery Lambda synchronously; returns the discovered schema or an error. */
export async function discoverViaLambda(
  secretArn: string, engine: string, schemas: string[],
): Promise<DiscoverViaLambdaResult> {
  const res = await lambda().send(new InvokeCommand({
    FunctionName: FUNCTION,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ secretArn, engine, schemas })),
  }));

  if (res.FunctionError) {
    return { ok: false, error: `discovery lambda error: ${res.FunctionError}` };
  }
  if (!res.Payload) return { ok: false, error: 'discovery lambda returned no payload' };
  let out: DiscoverViaLambdaResult;
  try {
    out = JSON.parse(Buffer.from(res.Payload).toString('utf8'));
  } catch {
    return { ok: false, error: 'discovery lambda returned invalid JSON' };
  }
  return out;
}
