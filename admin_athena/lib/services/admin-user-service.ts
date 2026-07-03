/**
 * Admin User Service - CRUD operations for user management.
 */

import prisma from '@/lib/db';
import { hashPassword } from '@/lib/encryption';
import { recordAuditLog } from './audit-service';

interface ListUsersParams {
  search?: string;
  roleId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listUsers(params: ListUsersParams = {}) {
  const { search, roleId, status, page = 1, pageSize = 50 } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (roleId) where.roleId = roleId;
  if (status) {
    where.status = status;
  } else {
    // By default, exclude soft-deleted users
    where.status = { not: 'DELETED' };
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { role: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      isAdmin: u.isAdmin,
      role: u.role,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
      forcePasswordChange: u.forcePasswordChange,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  roleId?: string;
  adminUserId: string;
  ipAddress: string | null;
}) {
  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        roleId: data.roleId || null,
        status: 'ACTIVE',
      },
      include: { role: { select: { id: true, name: true } } },
    });

    await recordAuditLog(tx, {
      userId: data.adminUserId,
      action: 'user.created',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: data.email, name: data.name, roleId: data.roleId },
      ipAddress: data.ipAddress,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt,
    };
  });
}

export async function updateUserStatus(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  adminUserId: string,
  ipAddress: string | null
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { status },
    });

    // If suspending, delete all sessions
    if (status === 'SUSPENDED') {
      await tx.session.deleteMany({ where: { userId } });
    }

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: status === 'SUSPENDED' ? 'user.suspended' : 'user.activated',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email },
      ipAddress,
    });

    return user;
  });
}

export async function changeUserRole(
  userId: string,
  roleId: string,
  adminUserId: string,
  ipAddress: string | null
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { roleId },
      include: { role: { select: { id: true, name: true } } },
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'user.role_changed',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email, newRoleId: roleId, newRoleName: user.role?.name },
      ipAddress,
    });

    return user;
  });
}

export async function updateUserName(
  userId: string,
  name: string,
  adminUserId: string,
  ipAddress: string | null
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { name },
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'user.name_updated',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email, newName: name },
      ipAddress,
    });

    return user;
  });
}

export async function toggleUserAdmin(
  userId: string,
  isAdmin: boolean,
  adminUserId: string,
  ipAddress: string | null
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { isAdmin },
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: isAdmin ? 'user.promoted_admin' : 'user.demoted_admin',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email },
      ipAddress,
    });

    return user;
  });
}

/**
 * Soft delete — blocks login, clears password, keeps all data
 * (conversations, messages, usage records, audit logs intact).
 * User can be re-invited later; their data will be preserved.
 */
export async function deleteUser(
  userId: string,
  adminUserId: string,
  ipAddress: string | null
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    if (user.status === 'DELETED') throw new Error('User is already deleted');

    // Prevent self-deletion
    if (userId === adminUserId) throw new Error('Cannot delete yourself');

    // Soft delete: mark as DELETED, clear password hash so login is impossible
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        passwordHash: 'DELETED_' + Date.now(), // Invalidate password
        roleId: null, // Remove role assignment
      },
    });

    // Delete all sessions (force logout)
    await tx.session.deleteMany({ where: { userId } });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'user.deleted',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email, name: user.name, type: 'soft_delete' },
      ipAddress,
    });
  });
}

export async function forcePasswordReset(
  userId: string,
  adminUserId: string,
  ipAddress: string | null
) {
  const RESET_EXPIRY_DAYS = 7;
  const APP_URL = process.env.ATHENA_URL || 'https://d7y8a8whrch88.cloudfront.net';

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { forcePasswordChange: true },
    });

    // Delete all sessions to force re-login
    await tx.session.deleteMany({ where: { userId } });

    // Create a 7-day password reset token
    const { generateToken } = await import('@/lib/encryption');
    const token = generateToken(32);
    await tx.passwordResetToken.create({
      data: {
        email: user.email,
        token,
        expiresAt: new Date(Date.now() + RESET_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'user.force_password_reset',
      targetType: 'User',
      targetId: userId,
      metadata: { email: user.email },
      ipAddress,
    });

    return { user, token };
  });

  // Send password reset email
  try {
    const { sendSmtpEmail } = await import('@/lib/email/smtp');
    const { buildPasswordResetEmailHtml } = await import('@/lib/email/password-reset-template');

    const resetUrl = `${APP_URL}/reset-password?token=${result.token}`;
    const emailHtml = buildPasswordResetEmailHtml({
      userName: result.user.name || '',
      resetUrl,
      expiresInDays: RESET_EXPIRY_DAYS,
    });

    const sent = await sendSmtpEmail({
      to: result.user.email,
      subject: 'Reset your password - LLMatscale.ai',
      html: emailHtml,
    });

    if (!sent) {
      console.log('[DEV] Password reset link:', `${APP_URL}/reset-password?token=${result.token}`);
    }
  } catch (err) {
    console.error('Failed to send reset email:', err);
  }

  return result.user;
}

export async function forceLogoutUser(
  userId: string,
  adminUserId: string,
  ipAddress: string | null
) {
  // REQ-02 — mark every ACTIVE user_session_logs row for this user as
  // CLOSED_ADMIN before deleting the Session rows. Done outside the
  // Prisma transaction because closeAllUserSessions uses raw SQL.
  const { closeAllUserSessions } = await import('../session-audit');
  const sessionLogsClosed = await closeAllUserSessions({
    userId,
    status: 'CLOSED_ADMIN',
    reason: 'admin_force',
  }).catch(() => 0);

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.session.deleteMany({ where: { userId } });

    await recordAuditLog(tx, {
      userId: adminUserId,
      action: 'user.force_logout',
      targetType: 'User',
      targetId: userId,
      metadata: { sessionsDeleted: deleted.count, sessionLogsClosed },
      ipAddress,
    });

    return { sessionsDeleted: deleted.count, sessionLogsClosed };
  });
}
