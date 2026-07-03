import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import { getSystemUsageSummary } from '@/lib/services/usage-service';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { FabOrchError } from '@/lib/errors/faborch-errors';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const url = new URL(req.url);
    const daysRaw = url.searchParams.get('days');
    const days = Number(daysRaw) || 30;
    if (days <= 0 || days > 365) {
      throw FabOrchError.invalidParameter('days', undefined, undefined, {
        badValue: daysRaw,
        validRange: '1..365',
      });
    }
    const data = await getSystemUsageSummary(days);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/admin/usage',
      userId: auth.user.id,
    });
  }
}
