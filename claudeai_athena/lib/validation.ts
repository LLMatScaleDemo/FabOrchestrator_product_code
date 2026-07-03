/**
 * Zod validation schemas for API request bodies
 * Provides type-safe validation for all API endpoints
 */

import { z } from 'zod';

// ============================================
// Auth Schemas
// ============================================

export const EmailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Invalid email format')
  .max(255, 'Email must be less than 255 characters');

export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be less than 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one uppercase letter, one lowercase letter, and one number'
  );

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().max(100).optional(),
});

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const PasswordResetRequestSchema = z.object({
  email: EmailSchema,
});

export const PasswordResetSchema = z.object({
  token: z.string().min(32, 'Invalid reset token'),
  newPassword: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: PasswordSchema,
});

// ============================================
// User Settings Schemas
// ============================================

export const UpdateProfileSchema = z.object({
  name: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export const UserPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  fontSize: z.number().min(12).max(24).optional(),
  codeTheme: z.string().max(50).optional(),
  messageDensity: z.enum(['compact', 'comfortable', 'spacious']).optional(),
});

export const AwsCredentialsSchema = z.object({
  accessKeyId: z
    .string()
    .regex(/^(AKIA|ASIA)[A-Z0-9]{16}$/, 'Invalid AWS access key format'),
  secretAccessKey: z
    .string()
    .min(20, 'Secret key must be at least 20 characters')
    .max(100, 'Secret key must be less than 100 characters'),
  region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, 'Invalid AWS region format').optional(),
});

// ============================================
// Conversation Schemas
// ============================================

export const CreateConversationSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().max(100).optional(),
});

export const UpdateConversationSchema = z.object({
  title: z.string().max(200).optional(),
  isPinned: z.boolean().optional(),
  isShared: z.boolean().optional(),
  model: z.string().max(100).optional(),
});

// ============================================
// Message Schemas
// ============================================

export const MessageRoleSchema = z.enum(['user', 'assistant', 'tool']);

export const CreateMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string().min(1, 'Message content is required').max(100000),
  parts: z.array(z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MessageFeedbackSchema = z.object({
  messageId: z.string().uuid('Invalid message ID'),
  feedback: z.enum(['positive', 'negative']),
  comment: z.string().max(1000).optional(),
});

// ============================================
// MCP Connection Schemas
// ============================================

export const McpAuthTypeSchema = z.enum(['none', 'api_key', 'oauth']);

export const CreateMcpConnectionSchema = z.object({
  name: z.string().min(1).max(100, 'Name must be less than 100 characters'),
  serverUrl: z.string().url('Invalid server URL'),
  authType: McpAuthTypeSchema.optional().default('none'),
  oauthClientId: z.string().max(500).optional(),
  oauthClientSecret: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
});

export const UpdateMcpConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  serverUrl: z.string().url().optional(),
  status: z.enum(['connected', 'disconnected', 'error']).optional(),
  isActive: z.boolean().optional(),
  lastError: z.string().max(1000).optional().nullable(),
  availableTools: z.array(z.unknown()).optional(),
  lastConnectedAt: z.date().optional(),
});

// ============================================
// Chat Request Schema
// ============================================

export const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().optional(),
    parts: z.array(z.unknown()).optional(),
  })).min(1),
  model: z.string().max(100).optional(),
  enableReasoning: z.boolean().optional(),
  conversationId: z.string().uuid().optional().nullable(),
  webSearch: z.boolean().optional(),
  activeMcpIds: z.array(z.string().uuid()).optional(),
});

// ============================================
// Validation Helper
// ============================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: z.ZodIssue[];
}

/**
 * Validate data against a Zod schema
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error.issues };
}

/**
 * Format Zod errors for API response
 */
export function formatValidationErrors(errors: z.ZodIssue[]): string {
  return errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
}

/**
 * Validate or throw the canonical INVALID_PARAMETER FabOrchError.
 * Use this in routes wrapped with withErrorHandling so validation
 * failures get the REQ-01 envelope automatically.
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  // Lazy import to avoid circular references at module init.
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

// Export types inferred from schemas
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;
export type PasswordResetInput = z.infer<typeof PasswordResetSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type UserPreferencesInput = z.infer<typeof UserPreferencesSchema>;
export type AwsCredentialsInput = z.infer<typeof AwsCredentialsSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;
export type MessageFeedbackInput = z.infer<typeof MessageFeedbackSchema>;
export type CreateMcpConnectionInput = z.infer<typeof CreateMcpConnectionSchema>;
export type UpdateMcpConnectionInput = z.infer<typeof UpdateMcpConnectionSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
