import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getIpAddress } from '@/lib/auth-middleware';
import { forcePasswordReset } from '@/lib/services/admin-user-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    await forcePasswordReset(id, auth.user.id, getIpAddress(req));
    return NextResponse.json({ success: true, message: 'User must change password on next login' });
  } catch (error) {
    console.error('Force reset error:', error);
    return NextResponse.json({ error: 'Failed to force password reset' }, { status: 500 });
  }
}
