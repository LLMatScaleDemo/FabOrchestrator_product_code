import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { parseWorkbook } from '@/lib/validation/xlsx';
import { createStagedUpload } from '@/lib/repo-cmf/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Parse a plain (non-template) Excel upload into structured rows server-side so
 * the chat client can append the data to the conversation without shipping a
 * binary through the model. Also stages the raw bytes so generateExcel can
 * later append rows into THIS file (startFromStagingId).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  let file: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach an .xlsx file in the 'file' field." }, { status: 400 });
  }
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!file.name.toLowerCase().endsWith('.xlsx') && file.type !== XLSX_MIME) {
    return NextResponse.json(
      { error: `Only Excel (.xlsx) files are supported — "${file.name}" was rejected.` },
      { status: 400 }
    );
  }

  try {
    const bytes = await file.arrayBuffer();
    const parsed = await parseWorkbook(bytes);
    const sheets = parsed.map((s) => ({ objectType: s.objectType, headers: s.headers, rows: s.rows }));
    const staged = await createStagedUpload({
      userId,
      filename: file.name,
      bytes: Buffer.from(bytes),
      packageName: `upload_${file.name.replace(/\.xlsx$/i, '')}`,
    });
    return NextResponse.json({ filename: file.name, sheets, uploadStagingId: staged.id });
  } catch (err) {
    console.error('[modeling-agent/chat/parse-upload] failed', err);
    return NextResponse.json(
      { error: 'Could not read that file as an Excel workbook. Re-export it and try again.' },
      { status: 400 }
    );
  }
}
