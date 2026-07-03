/**
 * Admin Tools - Tool definitions for AI-powered admin chat.
 * Each tool calls the same service layer as the API routes.
 * Uses plain objects compatible with AI SDK v6 streamText().
 */

import { z } from 'zod';
import { listUsers, updateUserStatus, changeUserRole, forcePasswordReset, deleteUser } from './services/admin-user-service';
import { listRoles, createRole, updateRole, deleteRole } from './services/role-service';
import { createInvitation, listInvitations, revokeInvitation, resendInvitation } from './services/invitation-service';
import { getSystemUsageSummary } from './services/usage-service';
import prisma from './db';

async function resolveUserId(userId?: string, userEmail?: string): Promise<string | null> {
  if (userId) return userId;
  if (userEmail) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: userEmail, mode: 'insensitive' } },
    });
    return user?.id || null;
  }
  return null;
}

export function getAdminTools(adminUserId: string) {
  return {
    list_users: {
      description: 'List all users with optional search, role, and status filters',
      inputSchema: z.object({
        search: z.string().optional().describe('Search by name or email'),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional().describe('Filter by status'),
        roleId: z.string().optional().describe('Filter by role ID'),
      }),
      execute: async ({ search, status, roleId }: { search?: string; status?: string; roleId?: string }) => {
        const result = await listUsers({ search, status, roleId });
        return {
          total: result.total,
          users: result.users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role?.name || 'No role',
            roleId: u.role?.id || null,
            status: u.status,
            isAdmin: u.isAdmin,
            lastLogin: u.lastLogin,
          })),
        };
      },
    },

    invite_user: {
      description: 'Invite a new user by sending an invitation email. The user will set their own password. Requires email and role.',
      inputSchema: z.object({
        email: z.string().email().describe('User email address to invite'),
        roleName: z.string().optional().describe('Role name (e.g. "Technical", "Business", "Basic"). If not provided, list roles first to get the ID.'),
        roleId: z.string().optional().describe('Role ID to assign. Use this if you already know the ID.'),
      }),
      execute: async ({ email, roleName, roleId }: { email: string; roleName?: string; roleId?: string }) => {
        // Resolve role by name if roleId not provided
        let resolvedRoleId = roleId;
        if (!resolvedRoleId && roleName) {
          const role = await prisma.role.findFirst({
            where: { name: { equals: roleName, mode: 'insensitive' } },
          });
          if (!role) {
            const allRoles = await prisma.role.findMany({ select: { id: true, name: true, description: true } });
            return {
              needsRole: true,
              message: `Role "${roleName}" not found. Here are the available roles:`,
              availableRoles: allRoles.map(r => ({ id: r.id, name: r.name, description: r.description })),
              pendingEmail: email,
            };
          }
          resolvedRoleId = role.id;
        }
        if (!resolvedRoleId) {
          const allRoles = await prisma.role.findMany({ select: { id: true, name: true, description: true } });
          return {
            needsRole: true,
            message: `Which role should ${email} be invited with? Here are the available roles:`,
            availableRoles: allRoles.map(r => ({ id: r.id, name: r.name, description: r.description })),
            pendingEmail: email,
          };
        }

        try {
          const result = await createInvitation({
            email,
            roleId: resolvedRoleId,
            adminUserId,
            ipAddress: 'chat-admin',
          });
          return {
            success: true,
            message: `Invitation sent to ${email}`,
            role: result.role,
            expiresAt: result.expiresAt,
            acceptUrl: result.acceptUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to send invitation' };
        }
      },
    },

    suspend_user: {
      description: 'Suspend a user account (blocks login, deletes sessions). Can lookup by email.',
      inputSchema: z.object({
        userId: z.string().optional().describe('User ID to suspend'),
        userEmail: z.string().optional().describe('User email to look up'),
      }),
      execute: async ({ userId, userEmail }: { userId?: string; userEmail?: string }) => {
        const id = await resolveUserId(userId, userEmail);
        if (!id) return { error: 'Provide userId or userEmail' };
        try {
          await updateUserStatus(id, 'SUSPENDED', adminUserId, 'chat-admin');
          return { success: true, message: 'User suspended and all sessions terminated' };
        } catch (err) { return { error: err instanceof Error ? err.message : 'Failed' }; }
      },
    },

    activate_user: {
      description: 'Activate a suspended user account. Can lookup by email.',
      inputSchema: z.object({
        userId: z.string().optional().describe('User ID to activate'),
        userEmail: z.string().optional().describe('User email to look up'),
      }),
      execute: async ({ userId, userEmail }: { userId?: string; userEmail?: string }) => {
        const id = await resolveUserId(userId, userEmail);
        if (!id) return { error: 'Provide userId or userEmail' };
        try {
          await updateUserStatus(id, 'ACTIVE', adminUserId, 'chat-admin');
          return { success: true, message: 'User activated' };
        } catch (err) { return { error: err instanceof Error ? err.message : 'Failed' }; }
      },
    },

    bulk_assign_role: {
      description: 'Assign a role to multiple users at once. Use this when changing role for more than one user. Provide either a list of user emails or "all_without_role" to target users with no role assigned.',
      inputSchema: z.object({
        userEmails: z.array(z.string()).optional().describe('List of user email addresses'),
        allWithoutRole: z.boolean().optional().describe('If true, target all users without a role'),
        excludeEmails: z.array(z.string()).optional().describe('Emails to exclude (e.g. admin)'),
        roleName: z.string().optional().describe('Role name to assign'),
        roleId: z.string().optional().describe('Role ID to assign'),
      }),
      execute: async ({ userEmails, allWithoutRole, excludeEmails, roleName, roleId }: { userEmails?: string[]; allWithoutRole?: boolean; excludeEmails?: string[]; roleName?: string; roleId?: string }) => {
        // Resolve role
        let resolvedRoleId = roleId;
        if (!resolvedRoleId && roleName) {
          const role = await prisma.role.findFirst({ where: { name: { equals: roleName, mode: 'insensitive' } } });
          if (!role) return { error: `Role "${roleName}" not found` };
          resolvedRoleId = role.id;
        }
        if (!resolvedRoleId) return { error: 'Provide roleName or roleId' };

        // Get target users
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = {};
        if (allWithoutRole) {
          where.roleId = null;
        } else if (userEmails && userEmails.length > 0) {
          where.email = { in: userEmails.map(e => e.toLowerCase()) };
        } else {
          return { error: 'Provide userEmails or set allWithoutRole=true' };
        }
        if (excludeEmails && excludeEmails.length > 0) {
          where.email = { ...where.email, notIn: excludeEmails.map(e => e.toLowerCase()) };
        }

        const users = await prisma.user.findMany({ where, select: { id: true, email: true, name: true } });
        if (users.length === 0) return { error: 'No matching users found' };

        // Bulk update
        const updated = await prisma.user.updateMany({
          where: { id: { in: users.map(u => u.id) } },
          data: { roleId: resolvedRoleId },
        });

        const roleName2 = (await prisma.role.findUnique({ where: { id: resolvedRoleId }, select: { name: true } }))?.name;

        return {
          success: true,
          message: `Assigned "${roleName2}" role to ${updated.count} users`,
          count: updated.count,
          users: users.map(u => u.name || u.email),
        };
      },
    },

    change_user_role: {
      description: 'Change a single user\'s assigned role. Can lookup user by name, email, or ID. Can lookup role by name. If role not specified, lists available roles.',
      inputSchema: z.object({
        userId: z.string().optional().describe('User ID (if known)'),
        userEmail: z.string().optional().describe('User email to look up'),
        userName: z.string().optional().describe('User display name to look up'),
        roleId: z.string().optional().describe('New role ID to assign'),
        roleName: z.string().optional().describe('Role name to assign (e.g. Technical, Business)'),
      }),
      execute: async ({ userId, userEmail, userName, roleId, roleName }: { userId?: string; userEmail?: string; userName?: string; roleId?: string; roleName?: string }) => {
        // Resolve user by ID, email, or name
        let resolvedUserId = userId;
        let resolvedUserName = '';
        if (!resolvedUserId && userEmail) {
          const user = await prisma.user.findFirst({ where: { email: { equals: userEmail, mode: 'insensitive' } } });
          if (!user) return { error: `User with email "${userEmail}" not found` };
          resolvedUserId = user.id;
          resolvedUserName = user.name || user.email;
        }
        if (!resolvedUserId && userName) {
          const users = await prisma.user.findMany({
            where: { name: { contains: userName, mode: 'insensitive' }, status: { not: 'DELETED' } },
            select: { id: true, name: true, email: true, role: { select: { name: true } } },
          });
          if (users.length === 0) return { error: `No user found with name "${userName}"` };
          if (users.length > 1) return {
            needsSelection: true,
            message: `Multiple users found matching "${userName}":`,
            users: users.map(u => ({ id: u.id, name: u.name, email: u.email, currentRole: u.role?.name || 'No role' })),
          };
          resolvedUserId = users[0].id;
          resolvedUserName = users[0].name || users[0].email;
        }
        if (!resolvedUserId) return { error: 'Provide userId, userEmail, or userName' };

        // Resolve role — if not provided, list available roles
        let resolvedRoleId = roleId;
        if (!resolvedRoleId && roleName) {
          const role = await prisma.role.findFirst({ where: { name: { equals: roleName, mode: 'insensitive' } } });
          if (!role) {
            const allRoles = await prisma.role.findMany({ select: { id: true, name: true, description: true } });
            return { needsRole: true, message: `Role "${roleName}" not found. Available roles:`, availableRoles: allRoles, pendingUser: resolvedUserName };
          }
          resolvedRoleId = role.id;
        }
        if (!resolvedRoleId) {
          const allRoles = await prisma.role.findMany({ select: { id: true, name: true, description: true } });
          return { needsRole: true, message: `Which role for ${resolvedUserName}?`, availableRoles: allRoles, pendingUser: resolvedUserName };
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const user = await changeUserRole(resolvedUserId, resolvedRoleId, adminUserId, 'chat-admin') as any;
          return { success: true, message: `Role changed to ${user.role?.name}`, userName: user.name, newRole: user.role?.name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to change role' };
        }
      },
    },

    force_password_reset: {
      description: 'Force a user to change their password. Sends a password reset email valid for 7 days and logs them out. Can lookup by email.',
      inputSchema: z.object({
        userId: z.string().optional().describe('User ID'),
        userEmail: z.string().optional().describe('User email to look up'),
      }),
      execute: async ({ userId, userEmail }: { userId?: string; userEmail?: string }) => {
        const id = await resolveUserId(userId, userEmail);
        if (!id) return { error: 'Provide userId or userEmail' };
        try {
          await forcePasswordReset(id, adminUserId, 'chat-admin');
          return { success: true, message: 'Password reset email sent. Link valid for 7 days. All sessions terminated.' };
        } catch (err) { return { error: err instanceof Error ? err.message : 'Failed' }; }
      },
    },

    list_roles: {
      description: 'List all roles with member counts and configurations',
      inputSchema: z.object({}),
      execute: async () => {
        const roles = await listRoles();
        return {
          total: roles.length,
          roles: roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            memberCount: r.memberCount,
            models: Array.isArray(r.allowedModels) ? (r.allowedModels as string[]).length : 0,
            requestLimit: r.dailyRequestLimit,
            tokenLimit: r.dailyTokenLimit,
            mcpEnabled: r.personalMcpEnabled,
          })),
        };
      },
    },

    create_role: {
      description: 'Create a new role. If models, permissions, or limits are not specified, return available options so the admin can choose.',
      inputSchema: z.object({
        name: z.string().describe('Role name'),
        description: z.string().optional().describe('Role description'),
        allowedModels: z.array(z.string()).optional().describe('Array of allowed model IDs. If empty or not provided, return available models to choose from.'),
        permissions: z.array(z.string()).optional().describe('Permissions: chat, mcp, artifacts, file_upload, web_search. Defaults to ["chat"] if not provided.'),
        dailyRequestLimit: z.number().nullable().optional().describe('Daily request limit (null=unlimited)'),
        dailyTokenLimit: z.number().nullable().optional().describe('Daily token limit (null=unlimited)'),
        personalMcpEnabled: z.boolean().optional().describe('Allow personal MCP connections'),
      }),
      execute: async (params: { name: string; description?: string; allowedModels?: string[]; permissions?: string[]; dailyRequestLimit?: number | null; dailyTokenLimit?: number | null; personalMcpEnabled?: boolean }) => {
        // If no models specified, return available options for the admin to pick
        if (!params.allowedModels || params.allowedModels.length === 0) {
          return {
            needsInput: true,
            message: `To create the "${params.name}" role, which models should users have access to?`,
            availableModels: [
              { id: 'claude-opus-4-6', name: 'Claude 4.6 Opus', tier: 'Most powerful' },
              { id: 'claude-sonnet-4-6', name: 'Claude 4.6 Sonnet', tier: 'Fast & intelligent' },
              { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet', tier: 'Complex tasks' },
              { id: 'claude-haiku-4-5-20251001', name: 'Claude 4.5 Haiku', tier: 'Fast & cheap' },
              { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus', tier: 'Complex reasoning' },
              { id: 'claude-opus-4-20250514', name: 'Claude 4 Opus', tier: 'Balanced' },
              { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet', tier: 'Balanced' },
            ],
            availablePermissions: ['chat', 'mcp', 'artifacts', 'file_upload', 'web_search'],
            hint: 'Also specify permissions and daily limits if needed. Defaults: permissions=["chat"], limits=unlimited.',
            pendingRoleName: params.name,
            pendingDescription: params.description,
          };
        }

        const roleData = {
          ...params,
          allowedModels: params.allowedModels,
          permissions: params.permissions || ['chat'],
        };

        try {
          const role = await createRole(roleData, adminUserId, 'chat-admin');
          return { success: true, role: { id: role.id, name: role.name } };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to create role' };
        }
      },
    },

    delete_user: {
      description: 'Permanently delete a user account and all their data. Cannot be undone. Can lookup by email.',
      inputSchema: z.object({
        userId: z.string().optional().describe('User ID to delete'),
        userEmail: z.string().optional().describe('User email to look up'),
        confirm: z.boolean().describe('Must be true to confirm deletion'),
      }),
      execute: async ({ userId, userEmail, confirm }: { userId?: string; userEmail?: string; confirm: boolean }) => {
        if (!confirm) return { error: 'Set confirm=true to proceed with deletion' };
        const id = await resolveUserId(userId, userEmail);
        if (!id) return { error: 'Provide userId or userEmail' };
        try {
          await deleteUser(id, adminUserId, 'chat-admin');
          return { success: true, message: 'User permanently deleted' };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to delete user' };
        }
      },
    },

    update_role: {
      description: 'Update an existing role — change name, description, allowed models, permissions, limits, or MCP settings',
      inputSchema: z.object({
        roleId: z.string().optional().describe('Role ID to update'),
        roleName: z.string().optional().describe('Role name to find (if roleId not known)'),
        name: z.string().optional().describe('New role name'),
        description: z.string().optional().describe('New description'),
        allowedModels: z.array(z.string()).optional().describe('New allowed model IDs list'),
        permissions: z.array(z.string()).optional().describe('New permissions list'),
        dailyRequestLimit: z.number().nullable().optional().describe('New daily request limit (null=unlimited)'),
        dailyTokenLimit: z.number().nullable().optional().describe('New daily token limit (null=unlimited)'),
        personalMcpEnabled: z.boolean().optional().describe('Allow personal MCP connections'),
        personalMcpMaxCount: z.number().optional().describe('Max personal MCP connections'),
        systemInstructions: z.string().optional().describe('Role-specific system instructions'),
      }),
      execute: async (params: { roleId?: string; roleName?: string; name?: string; description?: string; allowedModels?: string[]; permissions?: string[]; dailyRequestLimit?: number | null; dailyTokenLimit?: number | null; personalMcpEnabled?: boolean; personalMcpMaxCount?: number; systemInstructions?: string }) => {
        let resolvedId = params.roleId;
        if (!resolvedId && params.roleName) {
          const role = await prisma.role.findFirst({
            where: { name: { equals: params.roleName, mode: 'insensitive' } },
          });
          if (!role) return { error: `Role "${params.roleName}" not found` };
          resolvedId = role.id;
        }
        if (!resolvedId) return { error: 'Provide roleId or roleName' };

        const { roleId: _rid, roleName: _rn, ...updateData } = params;
        try {
          const role = await updateRole(resolvedId, updateData, adminUserId, 'chat-admin');
          return { success: true, role: { id: role.id, name: role.name } };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to update role' };
        }
      },
    },

    delete_role: {
      description: 'Delete a custom role. Cannot delete system roles or roles with assigned users. Shows user count and asks for confirmation first.',
      inputSchema: z.object({
        roleId: z.string().optional().describe('Role ID to delete'),
        roleName: z.string().optional().describe('Role name to find'),
        confirm: z.boolean().optional().describe('Set to true to confirm deletion after reviewing details'),
      }),
      execute: async ({ roleId, roleName, confirm }: { roleId?: string; roleName?: string; confirm?: boolean }) => {
        let resolvedId = roleId;
        if (!resolvedId && roleName) {
          const role = await prisma.role.findFirst({ where: { name: { equals: roleName, mode: 'insensitive' } } });
          if (!role) return { error: `Role "${roleName}" not found` };
          resolvedId = role.id;
        }
        if (!resolvedId) return { error: 'Provide roleId or roleName' };

        // Get role details with user count
        const role = await prisma.role.findUnique({
          where: { id: resolvedId },
          include: { _count: { select: { users: true } } },
        });
        if (!role) return { error: 'Role not found' };

        // If not confirmed, show details and ask
        if (!confirm) {
          return {
            needsConfirmation: true,
            role: role.name,
            isSystemRole: role.isSystemRole,
            userCount: role._count.users,
            message: role.isSystemRole
              ? `Cannot delete "${role.name}" — it is a system role.`
              : role._count.users > 0
                ? `Cannot delete "${role.name}" — ${role._count.users} user(s) are assigned to this role. Reassign them first.`
                : `Delete role "${role.name}"? This cannot be undone. Say "yes" to confirm.`,
            canDelete: !role.isSystemRole && role._count.users === 0,
          };
        }

        try {
          await deleteRole(resolvedId, adminUserId, 'chat-admin');
          return { success: true, message: `Role "${role.name}" deleted` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to delete role' };
        }
      },
    },

    list_invitations: {
      description: 'List all invitations with their status (PENDING, ACCEPTED, EXPIRED, REVOKED)',
      inputSchema: z.object({}),
      execute: async () => {
        const invitations = await listInvitations();
        return {
          total: invitations.length,
          invitations: invitations.map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role.name,
            status: inv.status,
            invitedBy: inv.invitedBy.name,
            createdAt: inv.createdAt,
            expiresAt: inv.expiresAt,
          })),
        };
      },
    },

    revoke_invitation: {
      description: 'Revoke a pending invitation so it can no longer be accepted',
      inputSchema: z.object({
        invitationId: z.string().describe('Invitation ID to revoke'),
      }),
      execute: async ({ invitationId }: { invitationId: string }) => {
        try {
          await revokeInvitation(invitationId, adminUserId, 'chat-admin');
          return { success: true, message: 'Invitation revoked' };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to revoke invitation' };
        }
      },
    },

    resend_invitation: {
      description: 'Resend an invitation email (generates a new token and resets expiry to 7 days)',
      inputSchema: z.object({
        invitationId: z.string().describe('Invitation ID to resend'),
      }),
      execute: async ({ invitationId }: { invitationId: string }) => {
        try {
          await resendInvitation(invitationId, adminUserId, 'chat-admin');
          return { success: true, message: 'Invitation resent with new 7-day expiry' };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to resend invitation' };
        }
      },
    },

    // ── MCP Management Tools ──

    add_mcp_to_role: {
      description: 'Add an MCP server connection to a role. All users in that role will have access to this MCP.',
      inputSchema: z.object({
        name: z.string().describe('Display name for the MCP connection'),
        serverUrl: z.string().describe('MCP server URL'),
        roleName: z.string().optional().describe('Role name to assign to'),
        roleId: z.string().optional().describe('Role ID to assign to'),
        authType: z.enum(['none', 'api_key']).optional().describe('Auth type (default: none)'),
        apiKey: z.string().optional().describe('API key if authType is api_key'),
      }),
      execute: async ({ name, serverUrl, roleName, roleId, authType, apiKey }: { name: string; serverUrl: string; roleName?: string; roleId?: string; authType?: string; apiKey?: string }) => {
        // Resolve role
        let resolvedRoleId = roleId;
        if (!resolvedRoleId && roleName) {
          const role = await prisma.role.findFirst({
            where: { name: { equals: roleName, mode: 'insensitive' } },
          });
          if (!role) return { error: `Role "${roleName}" not found` };
          resolvedRoleId = role.id;
        }
        if (!resolvedRoleId) {
          const allRoles = await prisma.role.findMany({ select: { id: true, name: true } });
          return { needsRole: true, message: 'Which role should this MCP be assigned to?', availableRoles: allRoles };
        }

        try {
          let encryptedCreds = null;
          if (authType === 'api_key' && apiKey) {
            const { encrypt } = await import('@/lib/encryption');
            encryptedCreds = encrypt(JSON.stringify({ apiKey }));
          }

          const conn = await prisma.mcpConnection.create({
            data: { userId: null, roleId: resolvedRoleId, name, serverUrl, authType: authType || 'none', authCredentialsEncrypted: encryptedCreds },
            include: { role: { select: { name: true } } },
          });
          return { success: true, message: `MCP "${name}" added to role ${conn.role?.name}`, id: conn.id };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to create MCP' };
        }
      },
    },

    list_role_mcps: {
      description: 'List all role-level MCP connections (assigned by admin, not personal)',
      inputSchema: z.object({}),
      execute: async () => {
        const connections = await prisma.mcpConnection.findMany({
          where: { userId: null },
          include: { role: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return {
          total: connections.length,
          connections: connections.map((c) => ({
            id: c.id,
            name: c.name,
            serverUrl: c.serverUrl,
            role: c.role?.name || 'Unassigned',
            status: c.status,
            isActive: c.isActive,
            toolCount: Array.isArray(c.availableTools) ? (c.availableTools as unknown[]).length : 0,
          })),
        };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // FabOrch Audit — per-user MCP visibility
    // ──────────────────────────────────────────────────────────────
    query_user_mcp_tools: {
      description:
        'Inspect every MCP server (and the tools each exposes) that a specific user has access to. Returns BOTH their personal MCP connections (if their role allows personal MCPs) AND the role-level MCP connections assigned to their role. Use this when an admin asks "what MCP tools does X have?", "list MCPs for X", or "what tools is X allowed to use?". Accepts a fuzzy userKey (matches name OR email OR email local-part).',
      inputSchema: z.object({
        userKey: z.string().optional().describe('Fuzzy identifier (preferred). Matches user.name, user.email, OR email local-part. Example: "bevincent" finds Bevin Edward / bevincent@llmatscale.ai.'),
        userEmail: z.string().email().optional().describe('Exact email lookup (only if you have the full address).'),
        userId: z.string().uuid().optional().describe('Direct user ID (rare; prefer userKey).'),
        includeInactive: z.boolean().optional().describe('If true, include MCPs with isActive=false. Default false.'),
      }),
      execute: async (input: {
        userKey?: string;
        userEmail?: string;
        userId?: string;
        includeInactive?: boolean;
      }) => {
        // 1. Resolve the user.
        let target = null as
          | (Awaited<ReturnType<typeof prisma.user.findFirst>> & { role: unknown })
          | null;
        if (input.userId) {
          target = await prisma.user.findUnique({
            where: { id: input.userId },
            include: { role: true },
          });
        } else if (input.userEmail) {
          target = await prisma.user.findFirst({
            where: { email: { equals: input.userEmail, mode: 'insensitive' } },
            include: { role: true },
          });
        } else if (input.userKey) {
          target = await prisma.user.findFirst({
            where: {
              OR: [
                { name: { contains: input.userKey, mode: 'insensitive' } },
                { email: { contains: input.userKey, mode: 'insensitive' } },
              ],
            },
            include: { role: true },
          });
        }

        if (!target) {
          return {
            found: false,
            message: 'No data found for that request.',
          };
        }

        // 2. Build query: union of personal (userId=target) and
        //    role-scoped (roleId=target.roleId, userId=null) MCPs.
        const userWithRole = target as typeof target & {
          roleId: string | null;
          role: { id: string; name: string; personalMcpEnabled: boolean } | null;
        };
        const role = userWithRole.role;

        const includeInactive = input.includeInactive === true;
        const activeFilter = includeInactive ? {} : { isActive: true };

        const personal = role?.personalMcpEnabled
          ? await prisma.mcpConnection.findMany({
              where: { userId: target.id, ...activeFilter },
              orderBy: { createdAt: 'desc' },
            })
          : [];

        const roleMcps = role
          ? await prisma.mcpConnection.findMany({
              where: { roleId: role.id, userId: null, ...activeFilter },
              orderBy: { createdAt: 'desc' },
            })
          : [];

        // 3. Shape the response.
        const formatConn = (c: (typeof personal)[number], source: 'personal' | 'role') => {
          const tools = Array.isArray(c.availableTools)
            ? (c.availableTools as Array<Record<string, unknown>>)
            : [];
          return {
            id: c.id,
            name: c.name,
            serverUrl: c.serverUrl,
            source,
            authType: c.authType,
            isActive: c.isActive,
            status: c.status,
            lastError: c.lastError,
            lastConnectedAt: c.lastConnectedAt,
            createdAt: c.createdAt,
            toolCount: tools.length,
            tools: tools.map((t) => ({
              name: t.name as string | undefined,
              description: t.description as string | undefined,
            })),
          };
        };

        const personalFormatted = personal.map((c) => formatConn(c, 'personal'));
        const roleFormatted = roleMcps.map((c) => formatConn(c, 'role'));
        const all = [...personalFormatted, ...roleFormatted];

        // 4. REQ-02 #4 style — record the audit query itself.
        prisma.auditLog
          .create({
            data: {
              userId: adminUserId,
              action: 'mcp_audit_query',
              targetType: 'McpConnection',
              targetId: target.id,
              metadata: {
                targetUser: { id: target.id, email: target.email, name: target.name },
                includeInactive,
                resultCount: all.length,
              },
            },
          })
          .catch(() => {});

        return {
          found: true,
          user: {
            id: target.id,
            name: target.name,
            email: target.email,
            status: target.status,
            role: role ? { id: role.id, name: role.name } : null,
            personalMcpEnabled: role?.personalMcpEnabled ?? false,
          },
          summary: {
            totalConnections: all.length,
            personalConnections: personalFormatted.length,
            roleConnections: roleFormatted.length,
            totalTools: all.reduce((sum, c) => sum + c.toolCount, 0),
          },
          connections: all,
          ...(all.length === 0
            ? {
                note: role?.personalMcpEnabled
                  ? `${target.name || target.email} has no MCP connections (personal nor role-level).`
                  : `${target.name || target.email}'s role does not allow personal MCPs and no role-level MCPs are assigned. They have no MCP access.`,
              }
            : {}),
        };
      },
    },

    remove_role_mcp: {
      description: 'Remove an MCP connection from a role',
      inputSchema: z.object({
        mcpId: z.string().describe('MCP connection ID to remove'),
        confirm: z.boolean().describe('Must be true to confirm'),
      }),
      execute: async ({ mcpId, confirm }: { mcpId: string; confirm: boolean }) => {
        if (!confirm) return { error: 'Set confirm=true to proceed' };
        const conn = await prisma.mcpConnection.findUnique({ where: { id: mcpId } });
        if (!conn) return { error: 'MCP connection not found' };
        if (conn.userId) return { error: 'This is a personal MCP, not a role-level one' };

        await prisma.mcpConnection.delete({ where: { id: mcpId } });
        return { success: true, message: `MCP "${conn.name}" removed` };
      },
    },

    check_usage: {
      description: 'Check system-wide usage statistics',
      inputSchema: z.object({
        days: z.number().optional().describe('Number of days to look back (default 30)'),
      }),
      execute: async ({ days }: { days?: number }) => {
        const data = await getSystemUsageSummary(days || 30);
        return {
          period: `Last ${days || 30} days`,
          totalRequests: data.totalRequests,
          totalTokens: data.totalTokens,
          modelBreakdown: data.perModel,
        };
      },
    },

    list_audit_logs: {
      description: 'View recent admin audit log entries',
      inputSchema: z.object({
        limit: z.number().optional().describe('Number of entries (default 20)'),
      }),
      execute: async ({ limit }: { limit?: number }) => {
        const logs = await prisma.auditLog.findMany({
          include: { user: { select: { email: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit || 20,
        });
        return {
          total: logs.length,
          logs: logs.map((l) => ({
            time: l.createdAt,
            action: l.action,
            admin: l.user?.email || 'system',
            target: l.targetType ? `${l.targetType}:${l.targetId}` : null,
          })),
        };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // FabOrch Audit — REQ-02 User Session Audit
    // ──────────────────────────────────────────────────────────────
    query_user_sessions: {
      description:
        'Query user_session_logs to answer admin questions like "is X idle now?", "when did X log in?", "who is currently logged in?", "idle > 30 min?", "all sessions today", "what idle gaps did X have?". Each row includes: userName/userEmail, loginTime, logoutTime, sessionDurationSeconds, idleSeconds (cumulative >60s gaps), activeSeconds, currentIdleSeconds (gap since last user-driven request), isIdleNow (true if ACTIVE and currentIdle>60), engagementLabel (PRE-DECIDED plain-English answer to "is the user idle/active/logged-in right now?" — quote it verbatim), idleEpisodes (array of {startedAt,endedAt,durationSeconds} — every gap that exceeded 60 seconds during the session), idleEpisodeCount, sessionStatus. PREFER `userKey` for fuzzy name/email matches. Capped at 1000 rows.',
      inputSchema: z.object({
        userKey: z.string().optional().describe('Fuzzy match. Substring against user.name OR user.email OR email local-part. Use this for ANY name/handle the admin mentions (e.g. "bevincent" matches both Bevin Edward and bevincent@llmatscale.ai).'),
        userEmail: z.string().email().optional().describe('Exact user email match. Only use when you have the complete email address.'),
        userNameLike: z.string().optional().describe('Substring match against user.name only (case-insensitive). Prefer userKey for general searches.'),
        userId: z.string().uuid().optional().describe('Direct user id (rare; prefer userKey or email)'),
        dateFrom: z.string().optional().describe('ISO 8601 lower bound on loginTime'),
        dateTo: z.string().optional().describe('ISO 8601 upper bound on loginTime'),
        status: z.enum(['active', 'closed', 'all']).optional().describe('Filter by current session status'),
        idleMinutesGt: z.number().optional().describe('Only ACTIVE sessions whose current idle gap exceeds this many minutes'),
        limit: z.number().optional().describe('Max rows (default 100, hard cap 1000)'),
      }),
      execute: async (input: {
        userKey?: string;
        userEmail?: string;
        userNameLike?: string;
        userId?: string;
        dateFrom?: string;
        dateTo?: string;
        status?: 'active' | 'closed' | 'all';
        idleMinutesGt?: number;
        limit?: number;
      }) => {
        const { querySessionLogs } = await import('./session-audit');
        const rows = await querySessionLogs({
          userId: input.userId ?? null,
          email: input.userEmail ?? null,
          nameLike: input.userNameLike ?? null,
          userKey: input.userKey ?? null,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : null,
          dateTo: input.dateTo ? new Date(input.dateTo) : null,
          status: input.status ?? 'all',
          idleMinutesGt: input.idleMinutesGt ?? null,
          limit: input.limit,
        });

        // REQ-02 #4 — every session-audit query is itself logged.
        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'session_audit_query',
            targetType: 'UserSessionLog',
            targetId: null,
            metadata: {
              filters: input,
              resultCount: rows.length,
            },
          },
        }).catch(() => {});

        const limit = Math.min(Math.max(1, input.limit ?? 100), 1000);
        const truncated = rows.length === limit;
        return {
          total: rows.length,
          truncated,
          rows: rows.map((r) => ({
            userName: r.userName,
            userEmail: r.userEmail,
            loginTime: r.loginTime,
            logoutTime: r.logoutTime,
            sessionDurationSeconds: r.sessionDurationSeconds,
            idleSeconds: r.idleSeconds,
            activeSeconds: r.activeSeconds,
            currentIdleSeconds: r.currentIdleSeconds,
            isIdleNow: r.isIdleNow,
            engagementLabel: r.engagementLabel,
            idleEpisodes: r.idleEpisodes,
            idleEpisodeCount: r.idleEpisodeCount,
            sessionStatus: r.sessionStatus,
            closedReason: r.closedReason,
            loginIp: r.loginIp,
          })),
          ...(truncated
            ? { note: 'Returned the first 1000 rows. Please refine your filter to narrow the results.' }
            : {}),
        };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // FabOrch Audit — REQ-03 Error Audit Log
    // ──────────────────────────────────────────────────────────────
    query_error_audit: {
      description:
        'Query error_audit_logs to answer admin questions like "show errors today", "what errors did X hit this week?", "how many SQL Call Failures in the last 7 days?", "all HIGH priority errors this month", "which errors are unresolved?", "errors between A and B". Each row carries the doc-spec 9 fields: errorId (ERR-YYYYMMDD-NNNN), errorType (one of the 10 from REQ-01), userName/userEmail, datetime, userMessage (plain-English), priority (HIGH/MEDIUM), status (OPEN/RESOLVED), resolvedBy/resolvedByName, resolvedAt — plus technicalMessage, route, httpStatus for context. Use userKey for fuzzy user lookup. When the admin asks "how many", combine with the count tool variant or report the rows.length. Capped at 1000.',
      inputSchema: z.object({
        userKey: z.string().optional().describe('Fuzzy user identifier (matches name OR email OR email local-part).'),
        userEmail: z.string().email().optional().describe('Exact user email.'),
        userId: z.string().uuid().optional(),
        errorType: z.enum([
          'SQL_CALL_FAILURE','RESPONSE_TIMEOUT','NO_ROWS_RETURNED','MISSING_FILTER',
          'INVALID_PARAMETER','DDL_DML_REJECTED','LAMBDA_MCP_CRASH','SESSION_TIMEOUT',
          'ROW_CAP_EXCEEDED','UNLISTED_STORED_PROC',
        ]).optional().describe('Filter by error type.'),
        priority: z.enum(['HIGH','MEDIUM']).optional().describe('Filter by priority.'),
        status: z.enum(['OPEN','RESOLVED','all']).optional().describe('Filter by resolution status.'),
        dateFrom: z.string().optional().describe('ISO 8601 lower bound on datetime'),
        dateTo: z.string().optional().describe('ISO 8601 upper bound on datetime'),
        errorIdLike: z.string().optional().describe('Substring match on the human ErrorID (e.g. "ERR-20260505-").'),
        limit: z.number().optional().describe('Max rows (default 100, hard cap 1000).'),
      }),
      execute: async (input: {
        userKey?: string; userEmail?: string; userId?: string;
        errorType?: string; priority?: 'HIGH'|'MEDIUM'; status?: 'OPEN'|'RESOLVED'|'all';
        dateFrom?: string; dateTo?: string; errorIdLike?: string; limit?: number;
      }) => {
        const { queryErrorAudit } = await import('./errors/error-audit');
        const { rows, truncated } = await queryErrorAudit({
          userId: input.userId ?? null,
          userKey: input.userKey ?? null,
          errorType: input.errorType ?? null,
          priority: input.priority ?? null,
          status: input.status ?? 'all',
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : null,
          dateTo: input.dateTo ? new Date(input.dateTo) : null,
          errorIdLike: input.errorIdLike ?? null,
          limit: input.limit,
        });

        // Self-log the audit query (mirrors REQ-02 pattern).
        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'error_audit_query',
            targetType: 'ErrorAuditLog',
            targetId: null,
            metadata: { filters: input, resultCount: rows.length },
          },
        }).catch(() => {});

        return {
          total: rows.length,
          truncated,
          rows: rows.map((r: typeof rows[number]) => ({
            errorId: r.errorId,
            errorType: r.errorType,
            userName: r.userName,
            userEmail: r.userEmail,
            datetime: r.datetime,
            errorMessage: r.userMessage,
            technicalMessage: r.technicalMessage,
            priority: r.priority,
            status: r.status,
            resolvedBy: r.resolvedByName || r.resolvedBy,
            resolvedAt: r.resolvedAt,
            resolutionNote: r.resolutionNote,
            route: r.route,
            httpStatus: r.httpStatus,
          })),
          ...(truncated
            ? { note: 'Returned the first 1000 rows. Please refine your filter to narrow the results.' }
            : {}),
        };
      },
    },

    mark_error_resolved: {
      description:
        'Mark a specific error_audit_logs row as RESOLVED. Use when the admin says "mark ERR-... as resolved" or "close ERR-... with note ...". Confirms by returning the updated row.',
      inputSchema: z.object({
        errorId: z.string().describe('Human ErrorID, e.g. "ERR-20260505-0007".'),
        note: z.string().optional().describe('Optional resolution note (audit trail).'),
      }),
      execute: async ({ errorId, note }: { errorId: string; note?: string }) => {
        const { markErrorResolved } = await import('./errors/error-audit');
        const ok = await markErrorResolved({ errorId, adminUserId, note });
        if (!ok) {
          return {
            success: false,
            message: `Either ${errorId} does not exist or it is already resolved.`,
          };
        }
        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'error_audit_resolve',
            targetType: 'ErrorAuditLog',
            targetId: errorId,
            metadata: { note: note ?? null },
          },
        }).catch(() => {});
        return { success: true, errorId, note: note ?? null, resolvedAt: new Date() };
      },
    },

    purge_old_errors: {
      description:
        'Manually run the 90-day error_audit_logs retention sweep. Returns the count of rows deleted. Only use when the admin explicitly asks to "purge old errors" or "clean up the error log".',
      inputSchema: z.object({
        confirm: z.boolean().describe('Must be true to proceed.'),
      }),
      execute: async ({ confirm }: { confirm: boolean }) => {
        if (!confirm) return { error: 'Set confirm=true to proceed.' };
        const { purgeOldErrors } = await import('./errors/error-audit');
        const deleted = await purgeOldErrors();
        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'error_audit_purge',
            targetType: 'ErrorAuditLog',
            targetId: null,
            metadata: { deleted },
          },
        }).catch(() => {});
        return { success: true, deletedRows: deleted };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // FabOrch Audit — REQ-04 Prompt & Response Audit Log
    // ──────────────────────────────────────────────────────────────
    query_prompt_audit: {
      description:
        'Query prompt_audit_logs to answer admin questions like "show all prompts today", "what did X ask this week?", "show failed prompts in the last 7 days", "what did PRO-... cost?", "who is the most expensive user this week?". Each row carries: promptId (PRO-YYYYMMDD-NNNN), userId (FK to users.id), userName, userEmail, datetime, userPrompt, topicMatched (one of the 7 use-case names or "AdminData" or null), queryExecuted (tool-call summary), dataRetrieved (tools+rows summary), llmResponse, responseTimeMs, status, toolCalls (array of {name, input, output} — output typically includes the SQL the MCP built plus the rows). PLUS per-turn token+cost columns: requestTokens/requestCost (turn 1 input — the model reading the user question), retrievalTokens/retrievalCost (turns 2..N input — feeding tool results back), responseTokens/responseCost (all turns\' output). totalTokens and totalCost are returned per row as computed sums. All costs are USD priced dynamically per-turn using each turn\'s model rate. Use userKey for fuzzy user lookup. Capped at 1000 rows.',
      inputSchema: z.object({
        userKey: z.string().optional().describe('Fuzzy user identifier (matches user_name, user_email, or email local-part).'),
        userEmail: z.string().email().optional().describe('Exact user email.'),
        publicStatus: z.enum(['Success','Failed']).optional().describe('Doc-style status. "Success" or "Failed" (collapses TIMEOUT/CANCELLED into Failed).'),
        status: z.enum(['PENDING','SUCCESS','FAILED','TIMEOUT','CANCELLED','all']).optional().describe('Granular internal status.'),
        topicMatched: z.enum([
          'Material Genealogy + Hold/Disposition',
          'Equipment OEE Report',
          'Scrap Pareto Analysis',
          'Bottleneck Analysis',
          'Cycle Time Outlier Detection',
          'Operator Performance Analysis',
          'Overall Facility Performance Insights',
          'AdminData',
        ]).optional().describe('Exact topic label — one of the 7 use cases or "AdminData".'),
        promptIdLike: z.string().optional().describe('Substring on the human PromptID, e.g. "PRO-20260505-".'),
        app: z.enum(['faborch','faborch-admin']).optional().describe('Restrict to FabOrch chat (topic_matched != AdminData) or admin chat (topic_matched = AdminData).'),
        dateFrom: z.string().optional().describe('ISO 8601 lower bound on datetime'),
        dateTo: z.string().optional().describe('ISO 8601 upper bound on datetime'),
        limit: z.number().optional().describe('Max rows (default 100, hard cap 1000).'),
      }),
      execute: async (input: {
        userKey?: string; userEmail?: string;
        publicStatus?: 'Success'|'Failed';
        status?: 'PENDING'|'SUCCESS'|'FAILED'|'TIMEOUT'|'CANCELLED'|'all';
        topicMatched?: string; promptIdLike?: string;
        app?: 'faborch'|'faborch-admin';
        dateFrom?: string; dateTo?: string; limit?: number;
      }) => {
        const { queryPromptAudit } = await import('./prompt-audit');
        const { rows, truncated } = await queryPromptAudit({
          userKey: input.userKey ?? null,
          userEmail: input.userEmail ?? null,
          publicStatus: input.publicStatus ?? null,
          status: input.status ?? 'all',
          topicMatched: input.topicMatched ?? null,
          promptIdLike: input.promptIdLike ?? null,
          app: input.app ?? null,
          dateFrom: input.dateFrom ? new Date(input.dateFrom) : null,
          dateTo: input.dateTo ? new Date(input.dateTo) : null,
          limit: input.limit,
        });

        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'prompt_audit_query',
            targetType: 'PromptAuditLog',
            targetId: null,
            metadata: { filters: input, resultCount: rows.length },
          },
        }).catch(() => {});

        return {
          total: rows.length,
          truncated,
          rows: rows.map((r: typeof rows[number]) => ({
            promptId: r.promptId,
            userId: r.userId,
            userName: r.userName,
            userEmail: r.userEmail,
            datetime: r.datetime,
            userPrompt: r.userPrompt,
            topicMatched: r.topicMatched,
            queryExecuted: r.queryExecuted,
            dataRetrieved: r.dataRetrieved,
            llmResponse: r.llmResponse,
            responseTimeMs: r.responseTimeMs,
            status: r.status,
            publicStatus: r.status === 'SUCCESS' ? 'Success' : 'Failed',
            // Full tool I/O — array of { name, input, output }. `output`
            // contains the underlying SQL/SP (in `_executed_sql`) plus
            // the rows the MCP server returned. Render this for
            // "show me the tool calls for PRO-..." or detail questions.
            toolCalls: r.toolCalls,
            // Per-turn token counts and USD costs (priced dynamically
            // per turn using that turn's model rate).
            requestTokens:   r.requestTokens,
            retrievalTokens: r.retrievalTokens,
            responseTokens:  r.responseTokens,
            totalTokens:
              (r.requestTokens ?? 0) + (r.retrievalTokens ?? 0) + (r.responseTokens ?? 0) || null,
            requestCost:   r.requestCost,
            retrievalCost: r.retrievalCost,
            responseCost:  r.responseCost,
            totalCost:
              ((r.requestCost   ? Number(r.requestCost)   : 0) +
               (r.retrievalCost ? Number(r.retrievalCost) : 0) +
               (r.responseCost  ? Number(r.responseCost)  : 0)) || null,
          })),
          ...(truncated
            ? { note: 'Returned the first 1000 rows. Please refine your filter to narrow the results.' }
            : {}),
        };
      },
    },

    purge_old_prompts: {
      description:
        'Manually run the 90-day prompt_audit_logs retention sweep. Returns the count of rows deleted. Only use when the admin explicitly asks to "purge old prompts" or "clean up the prompt log".',
      inputSchema: z.object({
        confirm: z.boolean().describe('Must be true to proceed.'),
      }),
      execute: async ({ confirm }: { confirm: boolean }) => {
        if (!confirm) return { error: 'Set confirm=true to proceed.' };
        const { purgeOldPrompts } = await import('./prompt-audit');
        const deleted = await purgeOldPrompts();
        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'prompt_audit_purge',
            targetType: 'PromptAuditLog',
            targetId: null,
            metadata: { deleted },
          },
        }).catch(() => {});
        return { success: true, deletedRows: deleted };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // REQ-04 Quality / Analytics — aggregate metrics from prompt_audit_logs
    // ──────────────────────────────────────────────────────────────
    prompt_quality_summary: {
      description:
        'Aggregate quality metrics from prompt_audit_logs over a date range. Use this when the admin asks about "success rate", "how many prompts failed today", "what % of prompts succeeded this week", "average response time", "slowest prompts", "topic distribution", "which topics fail the most", "any prompts cancelled", "total cost today", "total token usage this week", "cost by topic", "top spenders", "most expensive prompt". Returns counts, rates, response-time percentiles, status breakdown, topic distribution, top users (by volume AND by cost), token totals, USD cost totals, and per-topic cost. ALWAYS use this for any aggregate / "how many" / "what %" / "average" / "total cost" / "total tokens" question; never invent numbers. Date filters default to last 7 days if both omitted.',
      inputSchema: z.object({
        dateFrom: z.string().optional().describe('ISO 8601 lower bound on datetime. Default: 7 days ago.'),
        dateTo: z.string().optional().describe('ISO 8601 upper bound on datetime. Default: now.'),
        userKey: z.string().optional().describe('Restrict to a single user (fuzzy match on user_name/user_email).'),
        userEmail: z.string().email().optional().describe('Restrict to one exact user_email.'),
        app: z.enum(['faborch','faborch-admin']).optional().describe('Restrict to FabOrch chat (topic_matched != AdminData) or admin chat (topic_matched = AdminData).'),
        topicMatched: z.enum([
          'Material Genealogy + Hold/Disposition',
          'Equipment OEE Report',
          'Scrap Pareto Analysis',
          'Bottleneck Analysis',
          'Cycle Time Outlier Detection',
          'Operator Performance Analysis',
          'Overall Facility Performance Insights',
          'AdminData',
        ]).optional().describe('Restrict to a single topic.'),
      }),
      execute: async (input: {
        dateFrom?: string; dateTo?: string;
        userKey?: string; userEmail?: string;
        app?: 'faborch'|'faborch-admin';
        topicMatched?: string;
      }) => {
        // Build WHERE clause incrementally so the same filter logic feeds all
        // aggregation CTEs below.
        const conds: string[] = [];
        const values: unknown[] = [];
        const push = (sql: string, v: unknown) => {
          values.push(v);
          conds.push(sql.replace('$?', `$${values.length}`));
        };
        const dateFrom = input.dateFrom
          ? new Date(input.dateFrom)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dateTo = input.dateTo ? new Date(input.dateTo) : new Date();
        push(`datetime >= $?`, dateFrom);
        push(`datetime <= $?`, dateTo);
        if (input.userEmail) push(`user_email = $?`, input.userEmail);
        if (input.userKey) {
          const key = `%${input.userKey}%`;
          values.push(key, key, key);
          const a = `$${values.length - 2}`;
          const b = `$${values.length - 1}`;
          const c = `$${values.length}`;
          conds.push(
            `(user_name ILIKE ${a} OR user_email ILIKE ${b} OR split_part(user_email, '@', 1) ILIKE ${c})`
          );
        }
        if (input.app === 'faborch-admin') conds.push(`topic_matched = 'AdminData'`);
        else if (input.app === 'faborch') conds.push(`(topic_matched IS NULL OR topic_matched <> 'AdminData')`);
        if (input.topicMatched) push(`topic_matched = $?`, input.topicMatched);

        const where = `WHERE ${conds.join(' AND ')}`;

        // 1) Counts + rates + timing percentiles + token/cost totals in one pass.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const summary = (await prisma.$queryRawUnsafe(
          `SELECT
              COUNT(*)::int                                                          AS total,
              SUM(CASE WHEN status='SUCCESS'   THEN 1 ELSE 0 END)::int               AS success_count,
              SUM(CASE WHEN status='FAILED'    THEN 1 ELSE 0 END)::int               AS failed_count,
              SUM(CASE WHEN status='TIMEOUT'   THEN 1 ELSE 0 END)::int               AS timeout_count,
              SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END)::int               AS cancelled_count,
              SUM(CASE WHEN status='PENDING'   THEN 1 ELSE 0 END)::int               AS pending_count,
              ROUND(AVG(response_time_ms))::int                                      AS avg_response_ms,
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY response_time_ms)::int    AS p50_response_ms,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int    AS p95_response_ms,
              MAX(response_time_ms)::int                                             AS max_response_ms,
              COALESCE(SUM(request_tokens),   0)::bigint                             AS request_tokens_total,
              COALESCE(SUM(retrieval_tokens), 0)::bigint                             AS retrieval_tokens_total,
              COALESCE(SUM(response_tokens),  0)::bigint                             AS response_tokens_total,
              COALESCE(SUM(request_cost),     0)::numeric(14,6)                      AS request_cost_total,
              COALESCE(SUM(retrieval_cost),   0)::numeric(14,6)                      AS retrieval_cost_total,
              COALESCE(SUM(response_cost),    0)::numeric(14,6)                      AS response_cost_total
            FROM prompt_audit_logs
            ${where}`,
          ...values
        )) as Array<Record<string, number | string>>;
        const s = summary[0] || {};
        const total = Number(s.total ?? 0);
        const successCount = Number(s.success_count ?? 0);
        const successRate = total > 0 ? Math.round((successCount / total) * 1000) / 10 : null; // 1 dp

        // 2) Topic distribution.
        const topics = (await prisma.$queryRawUnsafe(
          `SELECT COALESCE(topic_matched, '(unmatched)') AS topic, COUNT(*)::int AS n
             FROM prompt_audit_logs
             ${where}
            GROUP BY 1
            ORDER BY n DESC`,
          ...values
        )) as Array<{ topic: string; n: number }>;

        // 3) Top users by prompt volume.
        const users = (await prisma.$queryRawUnsafe(
          `SELECT user_id, user_name, user_email, COUNT(*)::int AS n,
                  SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END)::int AS success_n,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)), 0)::numeric(14,6) AS total_cost,
                  COALESCE(SUM(COALESCE(request_tokens,0)+COALESCE(retrieval_tokens,0)+COALESCE(response_tokens,0)), 0)::bigint AS total_tokens
             FROM prompt_audit_logs
             ${where}
            GROUP BY user_id, user_name, user_email
            ORDER BY n DESC
            LIMIT 10`,
          ...values
        )) as Array<{ user_id: string | null; user_name: string | null; user_email: string | null; n: number; success_n: number; total_cost: string; total_tokens: bigint }>;

        // 3b) Top users by total cost (separate ranking — biggest spenders).
        const topSpenders = (await prisma.$queryRawUnsafe(
          `SELECT user_id, user_name, user_email, COUNT(*)::int AS n,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)), 0)::numeric(14,6) AS total_cost
             FROM prompt_audit_logs
             ${where}
            GROUP BY user_id, user_name, user_email
            ORDER BY total_cost DESC
            LIMIT 10`,
          ...values
        )) as Array<{ user_id: string | null; user_name: string | null; user_email: string | null; n: number; total_cost: string }>;

        // 3c) Cost per topic (so the admin can see which use case is most expensive).
        const costByTopic = (await prisma.$queryRawUnsafe(
          `SELECT COALESCE(topic_matched, '(unmatched)') AS topic,
                  COUNT(*)::int AS n,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)), 0)::numeric(14,6) AS total_cost,
                  COALESCE(AVG(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)), 0)::numeric(14,6) AS avg_cost_per_prompt
             FROM prompt_audit_logs
             ${where}
            GROUP BY 1
            ORDER BY total_cost DESC`,
          ...values
        )) as Array<{ topic: string; n: number; total_cost: string; avg_cost_per_prompt: string }>;

        // 4) Topics with the worst failure rate (only topics with >=3 prompts).
        const failingTopics = (await prisma.$queryRawUnsafe(
          `SELECT COALESCE(topic_matched, '(unmatched)') AS topic,
                  COUNT(*)::int AS n,
                  SUM(CASE WHEN status IN ('FAILED','TIMEOUT','CANCELLED') THEN 1 ELSE 0 END)::int AS failed_n,
                  ROUND(100.0 * SUM(CASE WHEN status IN ('FAILED','TIMEOUT','CANCELLED') THEN 1 ELSE 0 END) / COUNT(*), 1) AS failure_rate
             FROM prompt_audit_logs
             ${where}
            GROUP BY 1
           HAVING COUNT(*) >= 3
            ORDER BY failure_rate DESC, n DESC
            LIMIT 5`,
          ...values
        )) as Array<{ topic: string; n: number; failed_n: number; failure_rate: number }>;

        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'prompt_quality_summary',
            targetType: 'PromptAuditLog',
            targetId: null,
            metadata: { filters: input, total },
          },
        }).catch(() => {});

        // Bigint columns come back from pg as actual BigInt — serialize for JSON.
        const stringifyBig = (v: unknown) =>
          typeof v === 'bigint' ? Number(v) : v;

        const reqTok = Number(stringifyBig(s.request_tokens_total)   ?? 0);
        const retTok = Number(stringifyBig(s.retrieval_tokens_total) ?? 0);
        const resTok = Number(stringifyBig(s.response_tokens_total)  ?? 0);
        const reqCost = Number(s.request_cost_total   ?? 0);
        const retCost = Number(s.retrieval_cost_total ?? 0);
        const resCost = Number(s.response_cost_total  ?? 0);

        return {
          window: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
          totals: {
            total,
            success: s.success_count ?? 0,
            failed: s.failed_count ?? 0,
            timeout: s.timeout_count ?? 0,
            cancelled: s.cancelled_count ?? 0,
            pending: s.pending_count ?? 0,
          },
          successRatePct: successRate,
          responseTimeMs: {
            avg: s.avg_response_ms ?? null,
            p50: s.p50_response_ms ?? null,
            p95: s.p95_response_ms ?? null,
            max: s.max_response_ms ?? null,
          },
          tokenTotals: {
            request:   reqTok,
            retrieval: retTok,
            response:  resTok,
            total:     reqTok + retTok + resTok,
          },
          costTotalsUsd: {
            request:   reqCost,
            retrieval: retCost,
            response:  resCost,
            total:     +(reqCost + retCost + resCost).toFixed(6),
            avgPerPrompt: total > 0
              ? +((reqCost + retCost + resCost) / total).toFixed(6)
              : 0,
          },
          topicDistribution: topics,
          topUsers: users.map((u) => ({
            ...u,
            total_tokens: Number(stringifyBig(u.total_tokens) ?? 0),
            total_cost:   Number(u.total_cost ?? 0),
          })),
          topSpenders: topSpenders.map((u) => ({
            ...u,
            total_cost: Number(u.total_cost ?? 0),
          })),
          costByTopic: costByTopic.map((t) => ({
            ...t,
            total_cost:          Number(t.total_cost ?? 0),
            avg_cost_per_prompt: Number(t.avg_cost_per_prompt ?? 0),
          })),
          worstFailureRateTopics: failingTopics,
        };
      },
    },

    // ──────────────────────────────────────────────────────────────
    // Error Catalog — admin can view + edit user-facing error messages
    // ──────────────────────────────────────────────────────────────
    list_error_catalog: {
      description:
        'List all 10 canonical error types and their current user-facing messages. Use this when the admin asks things like "show me the error messages", "what does SQL_CALL_FAILURE say?", "list all error types". Read-only.',
      inputSchema: z.object({
        errorType: z.string().optional().describe('Optional: filter to one specific error_type (e.g. "MISSING_FILTER").'),
      }),
      execute: async ({ errorType }: { errorType?: string }) => {
        const rows = (await prisma.$queryRawUnsafe(
          errorType
            ? `SELECT error_type, user_message, priority, http_status, updated_at, updated_by FROM error_catalog WHERE error_type = $1`
            : `SELECT error_type, user_message, priority, http_status, updated_at, updated_by FROM error_catalog ORDER BY error_type ASC`,
          ...(errorType ? [errorType] : [])
        )) as Array<{
          error_type: string;
          user_message: string;
          priority: string;
          http_status: number;
          updated_at: Date;
          updated_by: string;
        }>;
        return { count: rows.length, entries: rows };
      },
    },

    update_error_catalog_message: {
      description:
        'Update the user-facing message for ONE error type. Use this when the admin says things like "change the SQL_CALL_FAILURE message to ...", "update MISSING_FILTER to say ...". Only `user_message` is editable — error_type, priority, and http_status are part of the canonical taxonomy and are locked. Changes propagate to the chat app within ~60 seconds (cache TTL); no redeploy needed.',
      inputSchema: z.object({
        errorType: z.enum([
          'SQL_CALL_FAILURE',
          'RESPONSE_TIMEOUT',
          'NO_ROWS_RETURNED',
          'MISSING_FILTER',
          'INVALID_PARAMETER',
          'DDL_DML_REJECTED',
          'LAMBDA_MCP_CRASH',
          'SESSION_TIMEOUT',
          'ROW_CAP_EXCEEDED',
          'UNLISTED_STORED_PROC',
        ]).describe('The canonical error type whose user_message you want to change.'),
        newMessage: z.string().min(1).max(500).describe('The new user-facing message (1–500 characters).'),
        confirm: z.boolean().describe('Must be true. Acts as a guard against accidental edits — set this only after the admin has explicitly approved the new wording.'),
      }),
      execute: async ({
        errorType,
        newMessage,
        confirm,
      }: {
        errorType: string;
        newMessage: string;
        confirm: boolean;
      }) => {
        if (!confirm) {
          return { error: 'Set confirm=true to proceed. Show the proposed new message to the admin first and ask them to confirm.' };
        }
        const trimmed = newMessage.trim();
        if (!trimmed) return { error: 'newMessage is empty after trimming.' };
        if (trimmed.length > 500) return { error: 'newMessage exceeds 500 characters.' };

        // Resolve editor email for the audit trail.
        const editor = await prisma.user.findUnique({
          where: { id: adminUserId },
          select: { email: true },
        });
        const editorEmail = editor?.email ?? 'admin';

        const updated = (await prisma.$queryRawUnsafe(
          `UPDATE error_catalog
              SET user_message = $1,
                  updated_at   = NOW(),
                  updated_by   = $2
            WHERE error_type   = $3
           RETURNING error_type, user_message, priority, http_status, updated_at, updated_by`,
          trimmed,
          editorEmail,
          errorType
        )) as Array<{
          error_type: string;
          user_message: string;
          priority: string;
          http_status: number;
          updated_at: Date;
          updated_by: string;
        }>;

        if (updated.length === 0) {
          return { error: `No row found for error_type ${errorType}.` };
        }

        prisma.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'error_catalog_update',
            targetType: 'ErrorCatalog',
            targetId: errorType,
            metadata: { newMessage: trimmed, errorType },
          },
        }).catch(() => {});

        return {
          success: true,
          message: 'Updated. The chat app will show the new message within ~60 seconds (cache TTL).',
          entry: updated[0],
        };
      },
    },
  };
}
