/**
 * GET /api/user/models
 * Returns models with user-facing labels.
 * Admin users see real model names. Regular users see custom labels.
 * Models not in user's role are returned as disabled (grayed out).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';
import { getRegistryModels } from '@/lib/model-registry';

// All platform models with custom labels for users — FALLBACK used whenever
// the shared model_registry table is empty or does not exist yet.
// 'available: true' = users can select it; 'available: false' = shown but grayed out (coming soon)
const ALL_MODELS = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', label: 'FabOrchestrator 1.0', available: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', label: 'FabOrchestrator 1.1', available: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', label: 'FabOrchestrator 2.0', available: true },
];

// The model selected by default (FabOrchestrator 2.0).
const DEFAULT_MODEL_ID = 'claude-opus-4-8';

// Shape shared by both the registry-backed and hardcoded model lists.
type BaseModel = { id: string; name: string; label: string; available: boolean };

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

    // Prefer the shared model_registry (managed by admin_athena). If the table
    // is empty / missing / unreadable, getRegistryModels() returns null/[] and
    // we fall back to the hardcoded ALL_MODELS list.
    const registry = await getRegistryModels();
    const baseModels: BaseModel[] =
      registry && registry.length > 0
        ? registry.map((m) => ({
            id: m.modelId,
            name: m.displayName,
            label: m.displayName,
            available: true,
          }))
        : ALL_MODELS;

    // The registry's isDefault model, else the hardcoded default.
    const registryDefaultId =
      registry && registry.length > 0
        ? registry.find((m) => m.isDefault)?.modelId
        : undefined;
    const defaultModelId = registryDefaultId ?? DEFAULT_MODEL_ID;

    // Build model list with enabled/disabled status
    // A model is enabled only if: it's marked 'available' AND the user's role allows it
    const models = baseModels.map((m) => {
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

    // Default to the registry/hardcoded default if enabled for this user, else first enabled.
    const enabledModels = models.filter((m) => m.enabled);
    const defaultModel =
      enabledModels.find((m) => m.id === defaultModelId)?.id ??
      enabledModels[0]?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID;

    return NextResponse.json({ models, defaultModel });
  } catch (error) {
    console.error('Get models error:', error);
    return NextResponse.json({
      models: ALL_MODELS.map((m) => ({ id: m.id, name: m.label, enabled: true })),
      defaultModel: DEFAULT_MODEL_ID,
    });
  }
}
