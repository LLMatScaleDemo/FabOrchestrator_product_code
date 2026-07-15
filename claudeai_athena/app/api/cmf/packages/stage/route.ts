import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/cmf/session";
import { createStagedUpload } from "@/lib/repo-cmf/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage an uploaded master-data file WITHOUT calling CMF. The file is stored so
 * it can be validated against the template first; only after validation passes
 * does `/register` push it to CMF. Returns a stagingId.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: { title: "Not signed in", description: "Sign in to continue." } },
        { status: 401 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            title: "No file attached",
            description: "Add a master-data Excel file (.xlsx) before submitting.",
          },
        },
        { status: 400 },
      );
    }

    // Excel-only: the master-data template is an .xlsx workbook.
    const XLSX_MIME =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!file.name.toLowerCase().endsWith(".xlsx") && file.type !== XLSX_MIME) {
      return NextResponse.json(
        {
          error: {
            title: "Unsupported file type",
            description: `Only Excel files (.xlsx) are supported — "${file.name}" was rejected.`,
          },
        },
        { status: 400 },
      );
    }

    const nameField = form.get("name");
    const packageName = typeof nameField === "string" && nameField.trim() ? nameField.trim() : undefined;

    const bytes = Buffer.from(await file.arrayBuffer());
    const staged = await createStagedUpload({ userId, filename: file.name, bytes, packageName });

    return NextResponse.json(
      { stagingId: staged.id, filename: staged.filename },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/cmf/packages/stage] failed", err);
    return NextResponse.json(
      { error: { title: "Upload failed", description: "Could not stage the file. Try again." } },
      { status: 500 },
    );
  }
}
