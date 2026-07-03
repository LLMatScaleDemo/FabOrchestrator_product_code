import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAnthropicFilesClient } from '@/lib/anthropic-files';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { fileId } = await params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return NextResponse.json({ error: 'Invalid file ID format' }, { status: 400 });
  }

  try {
    const client = getAnthropicFilesClient();
    const metadata = await client.beta.files.retrieveMetadata(fileId);

    return NextResponse.json({
      id: metadata.id,
      filename: metadata.filename,
      mime_type: metadata.mime_type,
      size_bytes: metadata.size_bytes,
    });
  } catch (error: unknown) {
    console.error('[Files] Metadata error:', error);
    const status = (error as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (status === 410) {
      return NextResponse.json({ error: 'File has expired' }, { status: 410 });
    }
    return NextResponse.json({ error: 'Failed to retrieve file metadata' }, { status: 500 });
  }
}
