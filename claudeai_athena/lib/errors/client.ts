/**
 * FabOrch Audit — REQ-01 client-side error helpers.
 *
 * Mirror of the canonical catalog for browser code. This file is
 * intentionally framework-free so it can be imported from any
 * component, page, or hook without server dependencies.
 */

export type FabOrchPriority = 'HIGH' | 'MEDIUM';

export interface FabOrchErrorEnvelope {
  errorId: string;
  type: string;
  priority: FabOrchPriority;
  message: string;
}

export interface FabOrchApiErrorBody {
  error: FabOrchErrorEnvelope;
}

/**
 * True if the parsed response body is a FabOrch error envelope.
 */
export function isFabOrchErrorBody(body: unknown): body is FabOrchApiErrorBody {
  if (!body || typeof body !== 'object') return false;
  const e = (body as { error?: unknown }).error;
  if (!e || typeof e !== 'object') return false;
  const env = e as Record<string, unknown>;
  return typeof env.errorId === 'string' &&
    typeof env.type === 'string' &&
    typeof env.message === 'string';
}

/**
 * Extract the canonical user-facing message from any fetch failure.
 * Falls back to a generic catalog-aligned message when the response
 * body is not a FabOrch envelope.
 */
export async function extractFabOrchMessage(response: Response): Promise<FabOrchErrorEnvelope> {
  try {
    const data = await response.clone().json();
    if (isFabOrchErrorBody(data)) return data.error;
  } catch {
    // response was not JSON — fall through
  }
  // Map raw HTTP status to a sensible default.
  const map: Record<number, FabOrchErrorEnvelope> = {
    400: { errorId: 'client', type: 'INVALID_PARAMETER', priority: 'HIGH', message: 'That value is not valid. Please choose one of the available options.' },
    401: { errorId: 'client', type: 'SESSION_TIMEOUT', priority: 'MEDIUM', message: 'Your session has expired. Please log in again.' },
    403: { errorId: 'client', type: 'DDL_DML_REJECTED', priority: 'HIGH', message: 'That operation is not permitted.' },
    404: { errorId: 'client', type: 'NO_ROWS_RETURNED', priority: 'HIGH', message: 'No data found for that request.' },
    408: { errorId: 'client', type: 'RESPONSE_TIMEOUT', priority: 'HIGH', message: 'The request took too long to complete. Please try again or narrow your request.' },
    503: { errorId: 'client', type: 'SQL_CALL_FAILURE', priority: 'HIGH', message: 'I cannot reach the data right now. Please retry.' },
    504: { errorId: 'client', type: 'RESPONSE_TIMEOUT', priority: 'HIGH', message: 'The request took too long to complete. Please try again or narrow your request.' },
  };
  return map[response.status] || {
    errorId: 'client',
    type: 'LAMBDA_MCP_CRASH',
    priority: 'HIGH',
    message: 'A backend service is temporarily unavailable. Please try again in a moment.',
  };
}

/**
 * Read a Response and either return the parsed JSON body or throw a
 * FabOrchClientError carrying the canonical envelope.
 */
export class FabOrchClientError extends Error {
  readonly envelope: FabOrchErrorEnvelope;
  readonly httpStatus: number;
  constructor(envelope: FabOrchErrorEnvelope, httpStatus: number) {
    super(envelope.message);
    this.name = 'FabOrchClientError';
    this.envelope = envelope;
    this.httpStatus = httpStatus;
  }
}

export async function parseOrThrow<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }
  const env = await extractFabOrchMessage(response);
  throw new FabOrchClientError(env, response.status);
}

/**
 * Read the soft row-cap warning emitted by listing endpoints.
 */
export function readRowCapWarning(response: Response): { type: string; message: string } | null {
  const type = response.headers.get('X-FabOrch-Warning');
  const message = response.headers.get('X-FabOrch-Warning-Message');
  if (!type || !message) return null;
  return { type, message };
}
