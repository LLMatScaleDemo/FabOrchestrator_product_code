/**
 * GET /api/user/models
 * Returns models with user-facing labels.
 * Admin users see real model names. Regular users see custom labels.
 * Models not in user's role are returned as disabled (grayed out).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';

// All platform models with custom labels for users
// 'available: true' = users can select it; 'available: false' = shown but grayed out (coming soon)
const ALL_MODELS = [
  { id: 'claude-sonnet-4-6', name: 'Claude 4.6 Sonnet', label: 'FabOrchestrator 1.0', available: true },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet', label: 'FabOrchestrator 1.1', available: false },
  { id: 'claude-opus-4-6', name: 'Claude 4.6 Opus', label: 'FabOrchestrator 2.0', available: false },
];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const userWithRole = await prisma.user.findUnique({
      where: { id: auth.user.id },
      include: { role: true },
    });

    const isAdmin = (userWithRole as { isAdmin?: boolean })?.isAdmin || false;
    const allowedModelIds = userWithRole?.role?.allowedModels;
    const allowedList = Array.isArray(allowedModelIds) ? allowedModelIds as string[] : [];

    // Build model list with enabled/disabled status
    // A model is enabled only if: it's marked 'available' AND the user's role allows it
    const models = ALL_MODELS.map((m) => {
      const roleAllows = allowedList.length === 0 || allowedList.includes(m.id);
      const isEnabled = m.available && roleAllows;
      return {
        id: m.id,
        // Admin sees real names, users see custom labels
        name: isAdmin ? m.name : m.label,
        realName: m.name,
        label: m.label,
        enabled: isAdmin ? roleAllows : isEnabled,
      };
    });

    // Default to first enabled model
    const enabledModels = models.filter((m) => m.enabled);
    const defaultModel = enabledModels.length > 0 ? enabledModels[0].id : models[0].id;

    return NextResponse.json({ models, defaultModel });
  } catch (error) {
    console.error('Get models error:', error);
    return NextResponse.json({
      models: ALL_MODELS.map((m) => ({ id: m.id, name: m.label, enabled: true })),
      defaultModel: 'claude-sonnet-4-6',
    });
  }
}
