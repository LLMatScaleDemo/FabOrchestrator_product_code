import { NextRequest, NextResponse } from 'next/server';
import {
  createConversation,
  getAllConversations,
  toConversationResponse,
} from '@/lib/storage';
import { requireAuth } from '@/lib/auth-middleware';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { applyRowCap } from '@/lib/errors/row-cap';

// GET /api/conversations - List all conversations
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const conversations = await getAllConversations(user.id);

    const mapped = conversations.map(c => ({
      id: c.id,
      title: c.title,
      isPinned: c.isPinned,
      isShared: c.isShared,
      model: c.model,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lastMessage: null,
    }));

    const { rows, warning } = applyRowCap(mapped);
    if (warning) {
      return NextResponse.json(rows, {
        headers: {
          'X-FabOrch-Warning': warning.type,
          'X-FabOrch-Warning-Message': warning.userMessage,
        },
      });
    }
    return NextResponse.json(rows);
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/conversations',
      userId: user.id,
    });
  }
}

// POST /api/conversations - Create a new conversation
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const body = await req.json();
    const { title, model } = body;

    const conversation = await createConversation({
      title: title || 'New Chat',
      model,
      userId: user.id,
    });

    return NextResponse.json(toConversationResponse(conversation), { status: 201 });
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/conversations',
      userId: user.id,
    });
  }
}
