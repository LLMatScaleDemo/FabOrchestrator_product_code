/**
 * Curated-prompt grounding for the chat route.
 *
 * Splits the work by what each side is actually good at:
 *  - the DASHBOARD is pre-built here from fixed SQL and a fixed layout, so it
 *    is identical every run and costs milliseconds to render;
 *  - the NARRATIVE is written by the model from the same rows, so the left-hand
 *    side gets a real high-level read of the data instead of boilerplate.
 *
 * The model is explicitly told NOT to author an artifact — the finished one is
 * appended to the stream after it finishes talking.
 */

import { fetchDashboardData, getDashboard, matchCurated } from '@/lib/fabinsight/dashboards';
import { glossaryBlock } from '@/lib/fabinsight/aliases';
import { renderDashboard } from '@/lib/fabinsight/render';
import type { FabRow } from '@/lib/fabinsight/mcp';

/** Keep the injected block bounded — a 300-row heat map should not eat the window. */
const MAX_ROWS_PER_SET = 40;

function renderSet(rows: FabRow[]): string {
  const shown = rows.slice(0, MAX_ROWS_PER_SET);
  const more =
    rows.length > MAX_ROWS_PER_SET ? `\n(${rows.length - MAX_ROWS_PER_SET} further rows omitted)` : '';
  return JSON.stringify(shown) + more;
}

export type CuratedTurn = {
  dashboardId: string;
  /** Unique per turn — ids derived from the dashboard alone collide when the
   *  same dashboard is asked for twice in one conversation. */
  turnId: string;
  title: string;
  /** Appended to the user's turn: the rows plus how to talk about them. */
  context: string;
  /** The finished artifact, ready to append to the stream verbatim. */
  artifactText: string;
  rowCount: number;
  tookMs: number;
  /** True when the warehouse gave us nothing — the model must not invent. */
  unavailable: boolean;
};

/**
 * If `text` is one of the curated prompts, fetch its data, pre-render the
 * dashboard, and build the model's context block. Returns null for every other
 * prompt — normal chat is untouched.
 */
export async function buildCuratedTurn(text: string): Promise<CuratedTurn | null> {
  const match = matchCurated(text);
  if (!match) return null;
  const def = getDashboard(match.meta.id);
  if (!def) return null;

  const turnId = `${def.id}-${Date.now().toString(36)}`;
  const data = await fetchDashboardData(def, match.overrides);
  const rowCount = data.sets.reduce((a, set) => a + set.rows.length, 0);
  const allFailed = data.sets.length > 0 && data.sets.every((set) => set.error);

  if (allFailed) {
    return {
      dashboardId: def.id,
      turnId,
      title: def.title,
      rowCount: 0,
      tookMs: data.tookMs,
      unavailable: true,
      artifactText: '',
      context: [
        '<live-manufacturing-data status="unavailable">',
        'The manufacturing data service did not respond, so there is no data for this request.',
        'Tell the user plainly that live manufacturing data is temporarily unavailable and to try again shortly.',
        'Do NOT invent any figures and do NOT describe a dashboard.',
        '</live-manufacturing-data>',
      ].join('\n'),
    };
  }

  const { summary, html, title } = renderDashboard(data);

  const blocks = data.sets.map((set) => {
    const body = set.error
      ? '(this data set failed to load — ignore it)'
      : set.rows.length === 0
        ? '(no rows — this measure is not recorded in this environment)'
        : renderSet(set.rows);
    return `### ${set.key} — ${set.label}\n${body}`;
  });

  // Only the shortforms this message actually used, so the cost is a few lines.
  const glossary = glossaryBlock(text);

  const context = [
    ...(glossary ? [glossary, ''] : []),
    '<live-manufacturing-data>',
    `Queried from the live manufacturing warehouse just now (${(data.tookMs / 1000).toFixed(
      1,
    )}s, ${rowCount} rows). These figures are REAL and CURRENT.`,
    '',
    ...(data.notes.length ? ['IMPORTANT CONTEXT:', ...data.notes.map((x) => `- ${x}`), ''] : []),
    ...blocks,
    '',
    `Headline already computed for you: ${summary}`,
    '</live-manufacturing-data>',
    '',
    '<how-to-answer>',
    'A finished visual dashboard for this request has ALREADY been built and will be attached to your',
    'reply automatically. Do NOT create an artifact, do NOT write HTML, and do NOT call any tool.',
    '',
    'Your job is the written analysis that sits beside it. Cover:',
    '  - the headline numbers that answer the question;',
    '  - what actually stands out — the constraint, the outlier, the thing worth acting on;',
    '  - anything the data itself flags (a measure with no rows, a percentage above 100 or a',
    '    negative scrap rate — these are real in this warehouse, not errors);',
    '  - what to look at next.',
    '',
    'FORMAT IT THE WAY YOU FORMAT ANY OTHER ANALYTICAL ANSWER in this app — your normal markdown:',
    'short bold section headings, bullet lists, bold for key figures, a small table where a table',
    'genuinely helps. Do not write one long wall of plain paragraphs.',
    '',
    'Use ONLY the numbers above — never invent, extrapolate or round away a figure.',
    'Refer to the attached dashboard naturally (e.g. "the dashboard breaks this down by area").',
    '</how-to-answer>',
  ].join('\n');

  return {
    dashboardId: def.id,
    turnId,
    title,
    context,
    rowCount,
    tookMs: data.tookMs,
    unavailable: false,
    // The identifier must be unique per TURN, not per dashboard. The artifact
    // parser derives its React key from it (`tag-artifact-<identifier>`), so a
    // constant id meant asking for the same dashboard twice in one conversation
    // produced two artifacts with the same key — React then warns and may drop
    // or duplicate one of them.
    artifactText: `\n\n<antArtifact identifier="${turnId}" type="text/html" title="${title}">\n${html}\n</antArtifact>`,
  };
}
