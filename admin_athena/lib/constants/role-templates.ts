/**
 * Default Role Templates
 *
 * Used by the seed script to create initial roles.
 * Adapted from Claude_ai-master role templates.
 */

export interface RoleTemplate {
  name: string;
  description: string;
  isSystemRole: boolean;
  permissions: string[];
  allowedModels: string[];
  systemInstructions: string | null;
  customInstructionsEnabled: boolean;
  customInstructionsMaxLength: number;
  personalMcpEnabled: boolean;
  personalMcpMaxCount: number;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
}

export const ALL_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
];

export const ALL_PERMISSIONS = [
  'admin',
  'chat',
  'mcp',
  'artifacts',
  'file_upload',
  'web_search',
  'modeling_agent', // enables the CMF master-data loader (Modeling Agent)
];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    name: 'Admin',
    description: 'Full platform access with admin capabilities',
    isSystemRole: true,
    permissions: ['admin', 'chat', 'mcp', 'artifacts', 'file_upload', 'web_search'],
    allowedModels: ALL_MODELS,
    systemInstructions: null,
    customInstructionsEnabled: false,
    customInstructionsMaxLength: 0,
    personalMcpEnabled: false,
    personalMcpMaxCount: 0,
    dailyRequestLimit: null,
    dailyTokenLimit: null,
  },
  {
    name: 'Business User',
    description: 'Business users with standard access',
    isSystemRole: true,
    permissions: ['chat', 'artifacts', 'file_upload'],
    allowedModels: [
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ],
    systemInstructions: null,
    customInstructionsEnabled: false,
    customInstructionsMaxLength: 0,
    personalMcpEnabled: false,
    personalMcpMaxCount: 0,
    dailyRequestLimit: null,
    dailyTokenLimit: null,
  },
  {
    name: 'Operator User',
    description: 'Operator users with rate-limited access',
    isSystemRole: true,
    permissions: ['chat', 'artifacts', 'file_upload'],
    allowedModels: [
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ],
    systemInstructions: null,
    customInstructionsEnabled: false,
    customInstructionsMaxLength: 0,
    personalMcpEnabled: false,
    personalMcpMaxCount: 0,
    dailyRequestLimit: 100,
    dailyTokenLimit: 200000,
  },
];
