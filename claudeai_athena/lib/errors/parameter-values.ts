/**
 * FabOrch Audit — REQ-01 list_parameter_values implementation.
 *
 * The requirements doc says invalid-parameter errors should "Return valid
 * options via list_parameter_values()". This module is the FabOrch
 * implementation: a registry that, given a parameter name, returns its
 * known-valid set.
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

export const ALLOWED_MCP_STATUSES: ReadonlyArray<string> = Object.freeze([
  'connected',
  'disconnected',
  'error',
]);

export const ALLOWED_MESSAGE_DENSITIES: ReadonlyArray<string> = Object.freeze([
  'compact',
  'comfortable',
  'spacious',
]);

export const ALLOWED_FEEDBACK_VALUES: ReadonlyArray<string> = Object.freeze([
  'positive',
  'negative',
]);

const STATIC_REGISTRY: Record<string, ReadonlyArray<string>> = {
  model: ALLOWED_MODELS,
  modelId: ALLOWED_MODELS,
  theme: ALLOWED_THEMES,
  role: ALLOWED_MESSAGE_ROLES,
  authType: ALLOWED_MCP_AUTH_TYPES,
  status: ALLOWED_MCP_STATUSES,
  messageDensity: ALLOWED_MESSAGE_DENSITIES,
  feedback: ALLOWED_FEEDBACK_VALUES,
};

export type ListParameterValuesResult = {
  parameter: string;
  validOptions: ReadonlyArray<string>;
};

/**
 * Synchronous lookup for parameters with statically-known valid sets.
 * Returns null for parameters that are not registered (caller should
 * fall back to the async resolver if dynamic lookup is appropriate).
 */
export function listParameterValuesSync(
  parameter: string
): ListParameterValuesResult | null {
  const validOptions = STATIC_REGISTRY[parameter];
  if (!validOptions) return null;
  return { parameter, validOptions };
}

/**
 * Resolves valid options for parameters, including DB-backed dynamic
 * sources (roleId, mcpId, conversationId, userId). Returns null if
 * the parameter is unknown.
 */
export async function listParameterValues(
  parameter: string,
  scope: { userId?: string } = {}
): Promise<ListParameterValuesResult | null> {
  const staticResult = listParameterValuesSync(parameter);
  if (staticResult) return staticResult;

  switch (parameter) {
    case 'roleId': {
      const { prisma } = await import('@/lib/db');
      const roles = await prisma.role.findMany({ select: { id: true } });
      return { parameter, validOptions: roles.map((r) => r.id) };
    }
    case 'mcpConnectionId':
    case 'mcpId': {
      if (!scope.userId) return { parameter, validOptions: [] };
      const { prisma } = await import('@/lib/db');
      const conns = await prisma.mcpConnection.findMany({
        where: {
          OR: [{ userId: scope.userId }, { roleId: { not: null }, userId: null }],
        },
        select: { id: true },
      });
      return { parameter, validOptions: conns.map((c) => c.id) };
    }
    case 'conversationId': {
      if (!scope.userId) return { parameter, validOptions: [] };
      const { prisma } = await import('@/lib/db');
      const convs = await prisma.conversation.findMany({
        where: { userId: scope.userId, deletedAt: null },
        select: { id: true },
        take: 1000,
      });
      return { parameter, validOptions: convs.map((c) => c.id) };
    }
    default:
      return null;
  }
}

/**
 * Throws a FabOrchError(INVALID_PARAMETER) populated with the valid
 * options for the given parameter. Convenience wrapper for call sites
 * that want one-line guarding.
 */
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
