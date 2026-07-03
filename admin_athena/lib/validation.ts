import { z } from 'zod';

// ============================================
// Auth Schemas
// ============================================

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password is required'),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

// ============================================
// User Schemas
// ============================================

export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  name: z.string().min(1, 'Name is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.string().uuid('Invalid role ID').optional(),
});

export const UpdateUserSchema = z.object({
  action: z.enum(['suspend', 'activate', 'changeRole', 'editName', 'toggleAdmin']),
  roleId: z.string().uuid('Invalid role ID').optional(),
  name: z.string().min(1).max(100).optional(),
});

// ============================================
// Role Schemas
// ============================================

export const CreateRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required').max(50),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).optional(),
  allowedModels: z.array(z.string()).optional(),
  systemInstructions: z.string().max(4000).optional(),
  customInstructionsEnabled: z.boolean().optional(),
  customInstructionsMaxLength: z.number().int().min(0).max(5000).optional(),
  personalMcpEnabled: z.boolean().optional(),
  personalMcpMaxCount: z.number().int().min(0).max(20).optional(),
  dailyRequestLimit: z.number().int().min(1).nullable().optional(),
  dailyTokenLimit: z.number().int().min(1).nullable().optional(),
  promptSuggestions: z.array(z.object({
    icon: z.string(),
    label: z.string(),
    prompt: z.string(),
  })).optional(),
});

export const UpdateRoleSchema = CreateRoleSchema.partial();

// ============================================
// Helpers
// ============================================

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): { data: T; error: null } | { data: null; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data, error: null };
  }
  return { data: null, error: result.error };
}

export function formatValidationErrors(error: z.ZodError): string {
  return error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
}

/**
 * Validate or throw the canonical INVALID_PARAMETER FabOrchError.
 * Use this in routes wrapped with withErrorHandling so validation
 * failures get the REQ-01 envelope automatically.
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FabOrchError } = require('./errors/faborch-errors') as typeof import('./errors/faborch-errors');
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const firstIssue = result.error.issues[0];
  throw FabOrchError.invalidParameter(
    firstIssue?.path.join('.') || 'request',
    undefined,
    result.error,
    { issues: result.error.issues }
  );
}

// ============================================
// Type exports
// ============================================

export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
