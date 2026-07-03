/**
 * Role Service - CRUD operations for role management.
 */

import prisma from '@/lib/db';
import { recordAuditLog } from './audit-service';

export interface CreateRoleData {
  name: string;
  description?: string;
  permissions?: string[];
  allowedModels?: string[];
  systemInstructions?: string;
  customInstructionsEnabled?: boolean;
  customInstructionsMaxLength?: number;
  personalMcpEnabled?: boolean;
  personalMcpMaxCount?: number;
  dailyRequestLimit?: number | null;
  dailyTokenLimit?: number | null;
  promptSuggestions?: Array<{ icon: string; label: string; prompt: string }>;
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: { _count: { select: { users: true, mcpConnections: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystemRole: r.isSystemRole,
    permissions: r.permissions,
    allowedModels: r.allowedModels,
    systemInstructions: r.systemInstructions,
    customInstructionsEnabled: r.customInstructionsEnabled,
    customInstructionsMaxLength: r.customInstructionsMaxLength,
    personalMcpEnabled: r.personalMcpEnabled,
    personalMcpMaxCount: r.personalMcpMaxCount,
    dailyRequestLimit: r.dailyRequestLimit,
    dailyTokenLimit: r.dailyTokenLimit,
    promptSuggestions: r.promptSuggestions,
    memberCount: r._count.users,
    mcpCount: r._count.mcpConnections,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createRole(
  data: CreateRoleData,
  adminUserId: string,
  ipAddress: string | null
) {
  // Check name uniqueness
  const existing = await prisma.role.findUnique({ where: { name: data.name } });
  if (existing) throw new Error(`Role "${data.name}" already exists`);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        name: data.name,
        description: data.description || null,
        permissions: data.permissions || [],
        allowedModels: data.allowedModels || [],
        systemInstructions: data.systemInstructions || null,
        customInstructionsEnabled: data.customInstructionsEnabled ?? true,
        customInstructionsMaxLength: data.customInstructionsMaxLength ?? 1000,
        personalMcpEnabled: data.personalMcpEnabled ?? false,
        personalMcpMaxCount: data.personalMcpMaxCount ?? 3,
        dailyRequestLimit: data.dailyRequestLimit ?? null,
        dailyTokenLimit: data.dailyTokenLimit ?? null,
        promptSuggestions: data.promptSuggestions || [],
      },
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'role.created',
      targetType: 'Role',
      targetId: role.id,
      metadata: { name: role.name },
      ipAddress,
    });

    return role;
  });
}

export async function updateRole(
  roleId: string,
  data: Partial<CreateRoleData>,
  adminUserId: string,
  ipAddress: string | null
) {
  // If name is changing, check uniqueness
  if (data.name) {
    const existing = await prisma.role.findFirst({
      where: { name: data.name, id: { not: roleId } },
    });
    if (existing) throw new Error(`Role "${data.name}" already exists`);
  }

  return prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.permissions !== undefined) updateData.permissions = data.permissions;
    if (data.allowedModels !== undefined) updateData.allowedModels = data.allowedModels;
    if (data.systemInstructions !== undefined) updateData.systemInstructions = data.systemInstructions;
    if (data.customInstructionsEnabled !== undefined) updateData.customInstructionsEnabled = data.customInstructionsEnabled;
    if (data.customInstructionsMaxLength !== undefined) updateData.customInstructionsMaxLength = data.customInstructionsMaxLength;
    if (data.personalMcpEnabled !== undefined) updateData.personalMcpEnabled = data.personalMcpEnabled;
    if (data.personalMcpMaxCount !== undefined) updateData.personalMcpMaxCount = data.personalMcpMaxCount;
    if (data.dailyRequestLimit !== undefined) updateData.dailyRequestLimit = data.dailyRequestLimit;
    if (data.dailyTokenLimit !== undefined) updateData.dailyTokenLimit = data.dailyTokenLimit;
    if (data.promptSuggestions !== undefined) updateData.promptSuggestions = data.promptSuggestions;

    const role = await tx.role.update({
      where: { id: roleId },
      data: updateData,
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'role.updated',
      targetType: 'Role',
      targetId: roleId,
      metadata: { name: role.name, updatedFields: Object.keys(updateData) },
      ipAddress,
    });

    return role;
  });
}

export async function deleteRole(
  roleId: string,
  adminUserId: string,
  ipAddress: string | null
) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { users: true } } },
  });

  if (!role) throw new Error('Role not found');
  if (role.isSystemRole) throw new Error('Cannot delete system roles');
  if (role._count.users > 0) throw new Error(`Cannot delete role with ${role._count.users} assigned users. Reassign them first.`);

  return prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'role.deleted',
      targetType: 'Role',
      targetId: roleId,
      metadata: { name: role.name },
      ipAddress,
    });
  });
}
