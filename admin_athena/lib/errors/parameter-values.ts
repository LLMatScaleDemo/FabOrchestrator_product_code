/**
 * FabOrch Audit — REQ-01 list_parameter_values implementation (admin app).
 */

import { FabOrchError } from './faborch-errors';

export const ALLOWED_MODELS: ReadonlyArray<string> = Object.freeze([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
]);

export const ALLOWED_THEMES: ReadonlyArray<string> = Object.freeze([
  'light',
  'dark',
  'system',
]);

export const ALLOWED_MESSAGE_ROLES: ReadonlyArray<string> = Object.freeze([
  'user',
  'assistant',
  'tool',
]);

export const ALLOWED_MCP_AUTH_TYPES: ReadonlyArray<string> = Object.freeze([
  'none',
  'api_key',
  'oauth',
]);

export const ALLOWED_USER_STATUSES: ReadonlyArray<string> = Object.freeze([
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'DELETED',
]);

export const ALLOWED_INVITATION_STATUSES: ReadonlyArray<string> = Object.freeze([
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
]);

const STATIC_REGISTRY: Record<string, ReadonlyArray<string>> = {
  model: ALLOWED_MODELS,
  modelId: ALLOWED_MODELS,
  theme: ALLOWED_THEMES,
  role: ALLOWED_MESSAGE_ROLES,
  authType: ALLOWED_MCP_AUTH_TYPES,
  userStatus: ALLOWED_USER_STATUSES,
  invitationStatus: ALLOWED_INVITATION_STATUSES,
};

export type ListParameterValuesResult = {
  parameter: string;
  validOptions: ReadonlyArray<string>;
};

export function listParameterValuesSync(
  parameter: string
): ListParameterValuesResult | null {
  const validOptions = STATIC_REGISTRY[parameter];
  if (!validOptions) return null;
  return { parameter, validOptions };
}

export async function listParameterValues(
  parameter: string,
  _scope: { userId?: string } = {}
): Promise<ListParameterValuesResult | null> {
  const staticResult = listParameterValuesSync(parameter);
  if (staticResult) return staticResult;

  switch (parameter) {
    case 'roleId': {
      const { prisma } = await import('@/lib/db');
      const roles = await prisma.role.findMany({ select: { id: true } });
      return { parameter, validOptions: roles.map((r) => r.id) };
    }
    case 'userId': {
      const { prisma } = await import('@/lib/db');
      const users = await prisma.user.findMany({
        select: { id: true },
        take: 1000,
      });
      return { parameter, validOptions: users.map((u) => u.id) };
    }
    default:
      return null;
  }
}

export async function rejectInvalidParameter(
  parameter: string,
  badValue: unknown,
  scope: { userId?: string } = {}
): Promise<never> {
  const lookup = await listParameterValues(parameter, scope);
  throw FabOrchError.invalidParameter(
    parameter,
    lookup?.validOptions,
    undefined,
    { badValue }
  );
}
