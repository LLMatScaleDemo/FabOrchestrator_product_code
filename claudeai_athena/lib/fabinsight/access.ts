/**
 * Who may create and pin dashboards.
 *
 * Per the Lumentum requirement: only an admin creates dashboards, but once
 * pinned they are viewable by every role. The check mirrors the existing
 * Modeling Agent gate (`/api/modeling-agent/access`) so the app has one notion
 * of "admin" rather than two.
 */

import { prisma } from '@/lib/db';

export async function isDashboardAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, role: { select: { name: true } } },
  });
  return user?.isAdmin === true || user?.role?.name === 'Admin';
}
