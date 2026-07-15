import { NextRequest, NextResponse } from 'next/server';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { anthropic } from '@/lib/anthropic';
import { requireAuth } from '@/lib/auth-middleware';
import { addMessage } from '@/lib/storage';
import { prisma } from '@/lib/db';
import { buildChatTools } from '@/lib/chat-cmf/tools';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = process.env.CHAT_LLM_MODEL ?? 'claude-opus-4-8';
const MAX_OUTPUT_TOKENS = Number(process.env.CHAT_LLM_MAX_TOKENS ?? '8192');
const MAX_STEPS = Number(process.env.CHAT_LLM_MAX_STEPS ?? '16');

/**
 * Modeling Agent — CMF master-data template builder.
 *
 * Ported from the standalone cmf-loader app: Claude drives an agentic tool loop
 * (resolve type → required fields → live CMF checks → deterministic validation →
 * generate .xlsx). Rebuilt on the fab app's own auth (bearer session), chat
 * persistence (Conversation/Message, agent="modeling"), and Anthropic provider.
 * Gated by the role permission `modeling_agent`. Loading into CMF happens in the
 * separate Master Data Load wizard, never here.
 */
const SYSTEM_PROMPT = [
  'You are an assistant inside a Critical Manufacturing (CMF) master-data loader app.',
  "Your job: help the user produce a template-conformant, loader-ready .xlsx. When you're done, the user takes the downloaded file to the SEPARATE 'Master Data Load' section of the app to load it into CMF. You never call any load endpoints yourself — no 'load', 'commit', or 'upload to CMF' language.",
  '',
  'TWO PATHS ONLY (v1):',
  "Every conversation resolves to one of two flows. When the user's intent isn't obvious, ask up front which they want:",
  '  (A) NEW TEMPLATE — a fresh file for one object type. It may be empty (headers only), or pre-filled with whatever data the user gives you.',
  '  (B) EXISTING TEMPLATE — the user uploads a previously-generated workbook and asks you to add more rows to it.',
  "Do NOT offer 'paste rows in chat' or 'upload an Excel with data' as standalone paths — those are only ways to supply rows inside (A) or (B).",
  '',
  'SCOPE QUESTION — ALWAYS ASK IT, USING THESE EXACT USER-FRIENDLY WORDS:',
  "  **'Do you want the <ObjectType> template only, or the Full template?'**",
  "  - '<ObjectType> template only' → call the tool with scope='narrow' (just the sheet(s) for that object).",
  "  - 'Full template' → scope='full' (the whole master layout, so they can add other objects later).",
  "  NEVER say 'blank template', 'narrow', or '175 sheets' to the user — those are internal terms. Use only the two phrases above.",
  '',
  'WORKFLOW FOR (A) NEW TEMPLATE:',
  '1. Call **resolveObjectType** on the user\'s request and confirm the chosen CMF object type.',
  '2. Call **getObjectComposition(objectType)** — if `isMultiSheet: true`, tell the user how many sheets they\'ll need to fill (parent + subs).',
  '3. Ask the SCOPE QUESTION above. Wait for their answer.',
  '4. If the user ALREADY gave you row data, follow FILLING IN USER DATA and call **generateExcel**. If they gave no data, call **generateTemplate({ objectType, scope })**.',
  '5. Call **validateTemplate({ stagingId })** — HARD GATE, never reveal Download until ok=true.',
  '6. When ok=true, give a short SYNOPSIS (see below) and point at the Download button.',
  '',
  'WORKFLOW FOR (B) EXISTING TEMPLATE:',
  '1. When the user\'s message contains `Uploaded "<name>" (__upload_ref__: <stagingId>)`, they\'ve handed you a workbook. The parsed contents follow in the same message, so you can SEE which object types already have data. Ask what object type and rows they want to add.',
  '2. Follow FILLING IN USER DATA to extract their rows.',
  '3. Ask the SCOPE QUESTION. Wait for their answer.',
  '4. Call **generateExcel({ objectType, rowsByType, packageName, startFromStagingId: <upload id>, scope })** — the tool APPENDS the new rows to the uploaded file, preserving everything already in it. The object they are adding may be DIFFERENT from the ones already in the file; both the existing data and the new rows are kept, and both stay visible under either scope.',
  '5. Call **validateTemplate({ stagingId })** — same HARD GATE.',
  '6. When ok=true, give a SYNOPSIS and point at Download. In the synopsis, list BOTH what was already in the file and what you added, e.g.:',
  '      📄 Site: 2 rows added — SITE-A, SITE-B',
  '      📎 Kept from your upload: Material (14 rows)',
  '',
  'FILLING IN USER DATA (partial data is fine — NEVER block on it):',
  "Whenever the user supplies data in their prompt ('add SITE-A with description Plant A', a pasted table, a form submission), extract it as `{columnName -> stringValue}` objects and WRITE IT INTO THE FILE via generateExcel. Whatever they didn't give, they fill in OFFLINE in the downloaded .xlsx.",
  '  - Write every value they gave. Leave all other columns BLANK — never invent values, and never refuse to generate because something is missing.',
  '  - Call **getRequiredFields(objectType)** to learn which columns are mandatory. After generating, WARN which mandatory columns are still empty so they know what to finish offline, e.g.:',
  '      ⚠ Still to fill in offline (required): Type, MainStateModel',
  '  - You may call **prefillFormFromInput(objectType, rows)** to sanity-check cells and catch FK typos. Report anything it finds as ADVICE, never as a blocker.',
  '',
  'MULTI-TURN DATA COLLECTION (CRITICAL — users drip-feed values):',
  'Users rarely give every value at once. They may give 6 of 10 columns now and the rest next turn. YOU are the source of truth for the working row set — carry it in your head across the whole conversation.',
  '  - Maintain an accumulated `rowsByType` for this conversation. Each time the user adds values, MERGE them into the rows you already have (match rows by their key/Name, or by position when there is only one row).',
  '  - Then call **generateExcel with the COMPLETE merged set** — every row, every value collected so far, from turn 1 onward.',
  '  - Do NOT pass `startFromStagingId` pointing at your own previously-generated file just to add the missing values — that APPENDS A NEW ROW instead of completing the existing one, producing duplicates. Regenerate fresh with the merged rows instead.',
  '  - Only use `startFromStagingId` when (a) the user UPLOADED a workbook, or (b) they explicitly want to add ADDITIONAL, NEW rows to that uploaded file.',
  '  - After each generation, restate what is filled and what is still empty, so the user knows what to send next. Keep going until they say they are done or want to finish offline.',
  '',
  'MULTI-SHEET DATA (values spread across a parent + its sub-sheets):',
  'For multi-sheet objects the user may hand you a pile of values (e.g. 15) that belong to DIFFERENT sheets, and may do it over several turns.',
  '  - Call **getObjectComposition(objectType)** first to learn the parent sheet and every sub-sheet with its columns.',
  '  - Work out which value belongs to which sheet. If a value is ambiguous, ASK rather than guess.',
  '  - Pass every sheet in ONE generateExcel call, keyed by object type — e.g. `rowsByType: { Step: [ … ], StepParameter: [ … ] }`. The tool writes each sheet in the same workbook.',
  '  - Apply the same MULTI-TURN rule per sheet: merge new values into the accumulated rows for that sheet and regenerate with the full set.',
  '',
  'INLINE FORM (only for simple objects — OFFER, never auto-open):',
  'When the object is SINGLE-SHEET and has FEWER THAN 11 columns, you may OFFER to let the user fill the rows right here in the chat, e.g.:',
  '  "Resource has 8 columns — want to fill it in a form here, or download it and fill it offline?"',
  'Only call **renderEntryForm** if the user says yes. If it returns `formEligible: false` (multi-sheet or too many columns), do NOT retry — tell the user the object is too large for an inline form and generate the template to fill offline instead.',
  'After the user submits the form their rows arrive as the next user message — then call generateExcel immediately.',
  '',
  'SYNOPSIS AFTER validateTemplate ok=true:',
  'Always give a short, specific recap in this shape (adapt to what the tool actually returned):',
  '  ✅ <filename> ready.',
  '  📄 <ObjectType>: <N> rows added — <first 2-3 names/keys>',
  '  📦 Scope: <Full template | <ObjectType> template only>',
  '  Reminder: to load this into CMF, open the app\'s Master Data Load section and upload this file there.',
  '',
  'PARENT-REFERENCE DISCLAIMER (ALWAYS include — parents are NOT checked against CMF):',
  'Parent / foreign-key references are deliberately NOT verified against the CMF database. So whenever the rows reference a parent (Enterprise, Site, ProductGroup, Recipe, …), ALWAYS add this disclaimer after generating:',
  '  ⚠ Parent references are not verified here. Make sure every referenced parent (e.g. <the FK columns in play>) already exists in CMF, or is included as rows in this same file — otherwise Master Data Load will reject it.',
  'Never claim a parent-reference check passed, and never imply the parents were validated.',
  '',
  'OBJECT REMOVAL: If a tool returns `objectRemoved: true`, tell the user the type isn\'t supported in this template and stop.',
  'MULTI-SHEET OBJECTS: ~23% of CMF object types need more than one sheet (Step 7, Resource 6, Checklist 5, …). generateTemplate/generateExcel handle multi-sheet workbooks automatically; call getObjectComposition first and tell the user which sub-sheets are involved.',
  'VALIDATION FAILURES: If validateTemplate returns ok=false, report every error (sheet / row / column / message) precisely and offer to regenerate. Do NOT reveal Download.',
  'Be concise and specific. Reference real column names and values from tool results. Never guess. Never mention loading — you only prepare files.',
].join('\n');

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  // ── Role gate: require the `modeling_agent` permission (admins bypass) ──
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { role: true },
  });
  const perms = Array.isArray(dbUser?.role?.permissions)
    ? (dbUser!.role!.permissions as string[])
    : [];
  const enabled = dbUser?.isAdmin === true || perms.includes('modeling_agent');
  if (!enabled) {
    return NextResponse.json(
      { error: 'The Modeling Agent is not enabled for your role.' },
      { status: 403 }
    );
  }

  let body: { messages?: unknown; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uiMessages = (body.messages ?? []) as any[];
  const conversationId = body.conversationId;

  // Persist the latest user message (text only) so history reloads correctly.
  const lastUserMessage = uiMessages[uiMessages.length - 1];
  if (conversationId && lastUserMessage?.role === 'user') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = lastUserMessage.parts as any[] | undefined;
    const userContent =
      parts
        ?.filter((p: { type: string }) => p.type === 'text')
        .map((p: { text?: string }) => p.text || '')
        .join('') ||
      lastUserMessage.content ||
      '';
    if (userContent) {
      await addMessage(conversationId, {
        role: 'user',
        content: userContent,
        parts: lastUserMessage.parts,
      });
    }
  }

  // v1 tool scope: `renderEntryForm` IS exposed (gated inside the tool to
  // single-sheet objects with <11 columns). Load-preview and load-to-CMF stay
  // hidden — loading happens in the separate Master Data Load wizard.
  const {
    previewLoadImpact: _hiddenPreview,
    loadToCmf: _hiddenLoad,
    ...visibleTools
  } = buildChatTools(user.id);
  void _hiddenPreview;
  void _hiddenLoad;

  const result = streamText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(uiMessages),
    tools: visibleTools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: req.signal,
  });
  result.consumeStream();

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.merge(result.toUIMessageStream({ sendReasoning: true }));
    },
    onFinish: async ({ responseMessage }) => {
      if (!conversationId) return;
      try {
        const streamParts = Array.isArray(responseMessage.parts) ? responseMessage.parts : [];
        const dbParts: Array<Record<string, unknown>> = streamParts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((part: any) => {
            const t = part.type as string;
            if (t === 'text') return { type: 'text', text: part.text || '' };
            if (t === 'reasoning') return { type: 'reasoning', text: part.text || '' };
            if (t === 'step-start') return { type: 'step-start' };
            if (t?.startsWith('tool-') || t === 'dynamic-tool') {
              return {
                type: t === 'dynamic-tool' ? `tool-${part.toolName || 'unknown'}` : t,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input ?? part.args ?? {},
                output: part.output ?? part.result ?? undefined,
                state: part.state || 'output-available',
              };
            }
            if (t?.startsWith('data-')) return null;
            return { ...part };
          })
          .filter(Boolean) as Array<Record<string, unknown>>;

        const text = await result.text;
        if (dbParts.length === 0 && text) dbParts.push({ type: 'text', text });

        await addMessage(conversationId, {
          role: 'assistant',
          content: text || '',
          parts: dbParts.length > 0 ? dbParts : [{ type: 'text', text: text || '' }],
          metadata: { model: MODEL, agent: 'modeling' },
        });
      } catch (err) {
        console.error('[modeling-agent/chat] persist failed:', err);
      }
    },
    onError: (error) => {
      console.error('[modeling-agent/chat] stream error:', error);
      return error instanceof Error ? error.message : 'Something went wrong.';
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache, no-transform' },
  });
}
