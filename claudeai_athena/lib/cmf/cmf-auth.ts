/**
 * CMF MES API token provider.
 *
 * The CMF Bearer JWT is minted every ~45 min by the separate `cmf-auth-token`
 * Lambda and published to AWS Secrets Manager (default secret `cmf/mes-token`,
 * us-west-2). This app is a READ-ONLY consumer: it fetches the secret, caches
 * it in memory, and refreshes ONLY when `expiresAt` is near — never on every
 * request (Secrets Manager has per-call cost + rate limits). We never mint or
 * write the token.
 *
 * Why read at runtime instead of an env var? The token ROTATES (~45 min) and
 * each JWT is valid only ~50 min. An env var is fixed at process start, so it
 * would go stale within the hour. WHERE we read (secret id / region / refresh
 * margin) is env-configurable; the token VALUE is always fetched live + cached.
 *
 * Secret payload shape: { token: "<jwt>", expiresAt: <ms epoch> }.
 *
 * IAM: the app/Lambda role needs `secretsmanager:GetSecretValue` on
 * arn:aws:secretsmanager:us-west-2:628203515088:secret:cmf/mes-token-*.
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = process.env.CMF_TOKEN_REGION ?? process.env.AWS_REGION ?? "us-west-2";
const SECRET_ID = process.env.CMF_TOKEN_SECRET_ID ?? "cmf/mes-token";
const MARGIN_MS = Number(process.env.TOKEN_SAFETY_MARGIN_SEC ?? "60") * 1000;

type TokenCache = { token: string; expiresAt: number };

let cache: TokenCache | null = null;
let inflight: Promise<string> | null = null;

let _sm: SecretsManagerClient | null = null;
function sm(): SecretsManagerClient {
  return (_sm ??= new SecretsManagerClient({ region: REGION }));
}

export class TokenUnavailableError extends Error {}

async function readTokenFromSecretsManager(): Promise<TokenCache> {
  let secretString: string | undefined;
  try {
    const res = await sm().send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    secretString = res.SecretString;
  } catch (err) {
    throw new TokenUnavailableError(
      `Could not read the CMF token secret "${SECRET_ID}" (${REGION}). It is refreshed on a schedule (~45 min); check IAM (secretsmanager:GetSecretValue) and retry. Cause: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!secretString) {
    throw new TokenUnavailableError(`CMF token secret "${SECRET_ID}" has no SecretString.`);
  }
  let parsed: { token?: string; expiresAt?: number };
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new TokenUnavailableError("CMF token secret is not valid JSON.");
  }
  if (!parsed.token || !parsed.expiresAt) {
    throw new TokenUnavailableError("CMF token secret is missing token/expiresAt.");
  }
  return { token: parsed.token, expiresAt: Number(parsed.expiresAt) };
}

function valid(entry: TokenCache | null): entry is TokenCache {
  return !!entry && Date.now() < entry.expiresAt - MARGIN_MS;
}

/**
 * Return a valid MES API Bearer token from the cached Secrets Manager value.
 * Refreshes only when the cached token is within MARGIN_MS of expiry. Throws
 * TokenUnavailableError if no valid token can currently be read.
 */
export async function getMesToken(): Promise<string> {
  if (valid(cache)) return cache.token;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const entry = await readTokenFromSecretsManager();
      if (!valid(entry)) {
        throw new TokenUnavailableError(
          "The published CMF token has expired. It is refreshed on a schedule (~45 min); retry shortly.",
        );
      }
      cache = entry;
      return entry.token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Test/debug helper: drop the in-memory cache so the next call re-reads the secret. */
export function clearMesTokenCache(): void {
  cache = null;
}
