import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset } from "@/lib/validation/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List existing parent-record names for a given object type. Used by the
 * inline EntryForm component to populate FK column dropdowns (Facility,
 * Product, ProductGroup, etc.) with what's already in CMF.
 *
 * Read-only. Capped at MAX_OPTIONS rows to keep dropdowns responsive — when a
 * parent table has more rows than the cap, the response includes `truncated:
 * true` so the UI can fall back to a typeable input.
 */
const MAX_OPTIONS = 500;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ targetType: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { targetType } = await params;
  try {
    const ruleset = await loadRuleset(targetType);
    if (!ruleset?.table) {
      return NextResponse.json({ options: [], reason: "no-table" }, { status: 200 });
    }

    // Order by Name so the dropdown is alphabetical; cap at MAX_OPTIONS+1 so we
    // can detect truncation cheaply.
    const rows = await cmfQuery<{ Name: string }>(
      `select top ${MAX_OPTIONS + 1} Name from [${ruleset.table.schema}].[${ruleset.table.name}] order by Name`,
    );
    const truncated = rows.length > MAX_OPTIONS;
    const options = rows.slice(0, MAX_OPTIONS).map((r) => String(r.Name));
    return NextResponse.json({ options, truncated, targetType });
  } catch (err) {
    console.error(`[api/cmf/chat/parent-options/${targetType}] failed`, err);
    return NextResponse.json(
      { error: "Could not load parent options.", options: [] },
      { status: 500 },
    );
  }
}
