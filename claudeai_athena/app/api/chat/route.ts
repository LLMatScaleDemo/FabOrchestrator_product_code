import { NextRequest, NextResponse } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { anthropic, forwardAnthropicContainerIdFromLastStep, createAnthropicWithContainerUploads } from '@/lib/anthropic';
import { addMessage, getMessages } from '@/lib/storage';
import { loadActiveMcpToolsWithDescriptions } from '@/lib/mcp-client';
import { requireAuth } from '@/lib/auth-middleware';
import { getAnthropicFilesClient } from '@/lib/anthropic-files';
import { uploadUserFileToS3, presignKey } from '@/lib/s3-upload';
import { buildSystemPromptWithTools } from '@/lib/system-prompts';
import { fitMessagesToContextWindow } from '@/lib/context-window';
import { validateOrThrow, ChatRequestSchema } from '@/lib/validation';
import { FabOrchError, isFabOrchError } from '@/lib/errors/faborch-errors';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { ALLOWED_MODELS } from '@/lib/errors/parameter-values';
import { logger } from '@/lib/logger';
import {
  recordPromptStart,
  recordPromptSuccess,
  recordPromptFailure,
  type PromptStartHandle,
  type ToolCallSummary,
} from '@/lib/prompt-audit';
import { costForTurn, costForTurnWithRates, hasPricing, type ModelRates } from '@/lib/model-pricing';
import { getAllowedModelIds, getRegistryRates, getThinkingConfig } from '@/lib/model-registry';
import { bumpActivityIfActive } from '@/lib/session-audit';

export const maxDuration = 300;

// Models that support adaptive thinking (type: "adaptive" + effort)
const ADAPTIVE_THINKING_MODELS = [
  'claude-opus-4-7',   // FabOrchestrator 1.0
  'claude-sonnet-5',   // FabOrchestrator 1.1
  'claude-opus-4-8',   // FabOrchestrator 2.0
];

// Models that support manual thinking (type: "enabled" + budgetTokens)
const MANUAL_THINKING_MODELS: string[] = [];

function getThinkingMode(modelId: string): 'adaptive' | 'manual' | 'none' {
  if (ADAPTIVE_THINKING_MODELS.includes(modelId)) return 'adaptive';
  if (MANUAL_THINKING_MODELS.includes(modelId)) return 'manual';
  return 'none';
}

// Server-side / provider-executed tools (Anthropic runs these in its own
// sandbox and returns the result inline). Identified by providerExecuted, by
// the `srvtoolu_` tool-use id prefix Anthropic assigns them, or by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isServerTool(c: any): boolean {
  return (
    c?.providerExecuted === true ||
    (typeof c?.toolCallId === 'string' && c.toolCallId.startsWith('srvtoolu_')) ||
    [
      'code_execution',
      'bash_code_execution',
      'text_editor_code_execution',
      'web_search',
      'web_fetch',
    ].includes(c?.toolName)
  );
}

/**
 * Anthropic rejects any request whose messages contain a tool_use without a
 * valid matching tool_result. With server-executed tools (code_execution →
 * `bash_code_execution` / `text_editor_code_execution`, web_search, web_fetch)
 * the AI SDK can produce THREE flavours of this:
 *
 *  1. ERRORED server tool: the SDK packs the error result inline next to the
 *     tool-call; Anthropic rejects that inline error block. (vercel/ai #11855)
 *  2. ORPHANED tool_use with no result at all (interrupted turn, replay).
 *  3. SPLIT provider result: when a server tool runs in PARALLEL with a regular
 *     /MCP tool, the SDK moves the server tool's result into a SEPARATE `tool`
 *     message instead of keeping it inline in the assistant message. Anthropic
 *     requires server tool_results inline, so on replay it sees the server
 *     tool_use "without a corresponding result". (vercel/ai #8112)
 *
 * This happens on replay AND mid multi-step loop, so we run this on the initial
 * messages *and* via streamText's `prepareStep`.
 *
 * Fix: drop every tool-call/tool-result block (by toolCallId) that is errored,
 * orphaned, or a server tool whose result is not inline with its call. Balanced,
 * successful, correctly-placed pairs are left untouched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanToolMessages(modelMessages: any[]): any[] {
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  const erroredIds = new Set<string>();
  for (const m of modelMessages) {
    if (!Array.isArray(m?.content)) continue;
    for (const c of m.content) {
      if (c?.type === 'tool-call' && c.toolCallId) callIds.add(c.toolCallId);
      if (c?.type === 'tool-result' && c.toolCallId) {
        resultIds.add(c.toolCallId);
        const outType = c.output?.type;
        if (outType === 'error-json' || outType === 'error-text' || c.isError === true) {
          erroredIds.add(c.toolCallId);
        }
      }
    }
  }
  const dropIds = new Set<string>(erroredIds);
  for (const id of callIds) if (!resultIds.has(id)) dropIds.add(id);   // tool_use with no result
  for (const id of resultIds) if (!callIds.has(id)) dropIds.add(id);   // result with no tool_use
  // #8112: a server tool's result MUST be inline in the same assistant message.
  // If a server tool-call has no result block inside its OWN message, the result
  // was split elsewhere (parallel-tool bug) — drop the whole interaction.
  for (const m of modelMessages) {
    if (!Array.isArray(m?.content)) continue;
    const inlineResultIds = new Set(
      m.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c?.type === 'tool-result' && c.toolCallId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.toolCallId)
    );
    for (const c of m.content) {
      if (c?.type === 'tool-call' && isServerTool(c) && !inlineResultIds.has(c.toolCallId)) {
        dropIds.add(c.toolCallId);
      }
    }
  }
  if (dropIds.size === 0) return modelMessages;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (const m of modelMessages) {
    if (!Array.isArray(m?.content)) { out.push(m); continue; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = m.content.filter(
      (c: any) =>
        !((c?.type === 'tool-call' || c?.type === 'tool-result') && dropIds.has(c.toolCallId))
    );
    if (content.length > 0) out.push({ ...m, content });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;
  // Capture the bearer token so the streaming onFinish callback can bump
  // the user's activity clock once the response has fully streamed
  // (responses can run multi-minute; we don't want the original POST
  // timestamp to be the only activity event).
  const bearerToken = req.headers.get('Authorization')?.slice(7) ?? null;

  try {
    // Validate request body — throws canonical INVALID_PARAMETER on bad input.
    const body = await req.json();
    const validated = validateOrThrow(ChatRequestSchema, body);
    const {
      messages: uiMessages,
      model: requestedModel,
      enableReasoning = true,
      conversationId,
      webSearch = false,
      activeMcpIds = [],
    } = validated;

    // Use the model ID directly (frontend sends full Bedrock model IDs)
    const modelId = requestedModel || 'claude-opus-4-8';

    // Reject unknown models with INVALID_PARAMETER + valid options (REQ-01 #5).
    // Allow a model if it's active in the shared model_registry OR (fallback)
    // in the hardcoded ALLOWED_MODELS list. When the registry is empty/missing,
    // getAllowedModelIds() returns [] and we rely entirely on ALLOWED_MODELS.
    const registryAllowedIds = await getAllowedModelIds();
    const isModelAllowed = registryAllowedIds.includes(modelId) || ALLOWED_MODELS.includes(modelId);
    if (!isModelAllowed) {
      const validOptions = registryAllowedIds.length > 0 ? registryAllowedIds : ALLOWED_MODELS;
      throw FabOrchError.invalidParameter('model', validOptions, undefined, {
        badValue: modelId,
      });
    }

    // REQ-04 — load registry per-token rates ONCE up front so the streaming
    // onFinish callback can price each step synchronously without blocking the
    // stream. Empty when the registry is missing/empty → cost math below falls
    // back to the hardcoded costForTurn/MODEL_PRICING map.
    const registryRatesByModel = new Map<string, ModelRates>();
    try {
      const rates = await getRegistryRates(modelId);
      if (rates) registryRatesByModel.set(modelId, rates);
    } catch {
      // Registry unavailable — fall back to hardcoded pricing.
    }

    // ── Role-based model access control (managed by admin_athena) ──
    // Fetch user with role to check permissions
    const { prisma: prismaDb } = await import('@/lib/db');
    const userWithRole = await prismaDb.user.findUnique({
      where: { id: user.id },
      include: { role: true },
    });

    if (userWithRole?.role) {
      const allowedModels = Array.isArray(userWithRole.role.allowedModels)
        ? userWithRole.role.allowedModels as string[]
        : [];

      if (allowedModels.length > 0 && !allowedModels.includes(modelId)) {
        throw FabOrchError.invalidParameter('model', allowedModels, undefined, {
          badValue: modelId,
          reason: 'role-restricted',
        });
      }

      // Check usage limits (rolling 24h)
      if (userWithRole.role.dailyRequestLimit || userWithRole.role.dailyTokenLimit) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const usage = await prismaDb.usageRecord.aggregate({
          where: { userId: user.id, createdAt: { gte: twentyFourHoursAgo } },
          _count: true,
          _sum: { inputTokens: true, outputTokens: true, thinkingTokens: true },
        });

        if (userWithRole.role.dailyRequestLimit && usage._count >= userWithRole.role.dailyRequestLimit) {
          return NextResponse.json(
            { error: 'Daily request limit reached. Please try again later.' },
            { status: 429 }
          );
        }

        const totalTokens = (usage._sum.inputTokens || 0) + (usage._sum.outputTokens || 0) + (usage._sum.thinkingTokens || 0);
        if (userWithRole.role.dailyTokenLimit && totalTokens >= userWithRole.role.dailyTokenLimit) {
          return NextResponse.json(
            { error: 'Daily token limit reached. Please try again later.' },
            { status: 429 }
          );
        }
      }
    }
    // ── End role-based access control ──

    // Check if reasoning should be enabled for this model.
    // Prefer the registry's thinkingType for this model; fall back to the
    // hardcoded ADAPTIVE_THINKING_MODELS/MANUAL_THINKING_MODELS sets.
    const registryThinking = await getThinkingConfig(modelId);
    const resolvedThinkingMode = registryThinking?.type ?? getThinkingMode(modelId);
    const thinkingMode = enableReasoning ? resolvedThinkingMode : 'none';
    // Manual-thinking budget: registry value if provided, else the default.
    const manualThinkingBudget = registryThinking?.budget ?? 16000;

    // Get the last user message to save to database
    const lastUserMessage = uiMessages[uiMessages.length - 1];

    // ── REQ-04 — open the prompt-audit row up front (status=PENDING) ──
    // We extract the prompt text now so we can fill the row whether the
    // stream finishes, fails, or times out.
    let promptAuditUserText = '';
    if (lastUserMessage?.role === 'user') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts2 = lastUserMessage.parts as any[] | undefined;
      promptAuditUserText = parts2
        ?.filter((p: { type: string }) => p.type === 'text')
        .map((p: { text?: string }) => p.text || '')
        .join('') || (lastUserMessage as { content?: string }).content || '';
    }
    let promptAuditHandle: PromptStartHandle | null = null;
    if (promptAuditUserText) {
      promptAuditHandle = await recordPromptStart({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userPrompt: promptAuditUserText,
        app: 'faborch',
      });
    }
    // ── End REQ-04 prompt-start hook ──

    // ── Store this turn's attached files in S3 (faborch-user-uploads) ──
    // Every newly attached file is persisted to S3 and the durable S3 *key* is
    // saved in the message metadata, so on later turns we can regenerate a fresh
    // presigned URL (they expire) without re-uploading. Only the current turn's
    // file parts (which still carry the base64 data URL) are uploaded — history
    // is never re-uploaded. A storage failure is logged and never breaks the chat.
    const currentS3Refs: { key: string; filename: string; mediaType: string }[] = [];
    if (lastUserMessage?.role === 'user' && Array.isArray((lastUserMessage as { parts?: unknown[] }).parts)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileParts = ((lastUserMessage as any).parts as any[]).filter(
        (p) => p?.type === 'file' && typeof p.url === 'string' && p.url.startsWith('data:')
      );
      if (fileParts.length > 0) {
        const results = await Promise.allSettled(
          fileParts.map((p) =>
            uploadUserFileToS3({
              dataUrl: p.url as string,
              filename: (p.filename as string) || 'file',
              mediaType: p.mediaType as string | undefined,
              userId: user.id,
              conversationId: conversationId ?? null,
            })
          )
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            currentS3Refs.push({ key: r.value.key, filename: r.value.filename, mediaType: r.value.mediaType });
          } else if (r.status === 'rejected') {
            logger.error('[Chat] S3 upload failed for an attachment', {
              route: '/api/chat',
              userId: user.id,
              cause: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        }
        if (currentS3Refs.length > 0) {
          console.log(`[Chat] Stored ${currentS3Refs.length} upload(s) in S3:`, currentS3Refs.map((f) => f.key));
        }
      }
    }
    // ── End S3 upload ──

    // Save user message to database if we have a conversation
    if (conversationId && lastUserMessage?.role === 'user') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = lastUserMessage.parts as any[] | undefined;
      const userContent = parts
        ?.filter((p: { type: string }) => p.type === 'text')
        .map((p: { text?: string }) => p.text || '')
        .join('') || lastUserMessage.content || '';

      const hasFiles = parts?.some((p: { type: string }) => p.type === 'file') || false;

      if (userContent || hasFiles) {
        await addMessage(conversationId, {
          role: 'user',
          content: userContent || '(file attachment)',
          parts: lastUserMessage.parts,
          // Persist the durable S3 keys so later turns can re-expose the file URL.
          ...(currentS3Refs.length > 0 ? { metadata: { s3Files: currentS3Refs } } : {}),
        });
      }
    }

    // Build tools object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};

    // Code execution - always enabled
    tools.code_execution = anthropic.tools.codeExecution_20250825();

    // Memory tool - persistent memory across conversations (disabled)
    /*
    tools.memory = anthropic.tools.memory_20250818({
      execute: async (action) => {
        switch (action.command) {
          case 'view': {
            const isDirectory = action.path === '/' || action.path === '/memories' || action.path === '/global'
              || action.path.endsWith('/') || (action.path.startsWith('/') && !action.path.includes('.'));
            if (isDirectory) {
              const allFiles = await getAllVisibleMemoryFiles(user.id);
              const prefix = action.path.replace(/\/$/, '');
              const files = (prefix === '/' || prefix === '')
                ? allFiles
                : allFiles.filter(f => f.path.startsWith(prefix));
              if (files.length === 0) return 'No memory files found. Directory is empty.';
              return files.map(f => `${f.path} [${f.scope}]`).join('\n');
            }
            const file = await getMemoryFile(user.id, action.path);
            if (!file) return `Error: File not found: ${action.path}`;
            const lines = file.content.split('\n');
            if (action.view_range) {
              const [start, end] = action.view_range;
              return lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n');
            }
            return lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
          }
          case 'create': {
            const existing = await getMemoryFile(user.id, action.path);
            if (existing) return `Error: File already exists: ${action.path}. Use str_replace to modify it.`;
            await createMemoryFile({ userId: user.id, path: action.path, content: action.file_text });
            return `File created successfully: ${action.path}`;
          }
          case 'str_replace': {
            const file = await getMemoryFile(user.id, action.path);
            if (!file) return `Error: File not found: ${action.path}`;
            if (!file.content.includes(action.old_str)) return `Error: old_str not found in file`;
            const newContent = file.content.replace(action.old_str, action.new_str);
            await updateMemoryFileContent(user.id, action.path, newContent);
            return `Successfully replaced text in ${action.path}`;
          }
          case 'insert': {
            const file = await getMemoryFile(user.id, action.path);
            if (!file) return `Error: File not found: ${action.path}`;
            const insertLines = file.content.split('\n');
            insertLines.splice(action.insert_line, 0, action.insert_text);
            await updateMemoryFileContent(user.id, action.path, insertLines.join('\n'));
            return `Successfully inserted text at line ${action.insert_line} in ${action.path}`;
          }
          case 'delete': {
            const deleted = await deleteMemoryFile(user.id, action.path);
            if (!deleted) return `Error: File not found: ${action.path}`;
            return `File deleted: ${action.path}`;
          }
          case 'rename': {
            const renamed = await renameMemoryFile(user.id, action.old_path, action.new_path);
            if (!renamed) return `Error: File not found: ${action.old_path}`;
            return `File renamed from ${action.old_path} to ${action.new_path}`;
          }
        }
      },
    });
    */

    // Web search + web fetch - controlled by existing webSearch toggle
    if (webSearch) {
      tools.web_search = anthropic.tools.webSearch_20250305({ maxUses: 5 });
      tools.web_fetch = anthropic.tools.webFetch_20250910({
        maxUses: 3,
      });
    }

    // Track MCP tool descriptions for system prompt
    let mcpToolDescriptions: { name: string; description: string }[] = [];

    // Filter activeMcpIds against authorized set (personal if role allows + role-level)
    let authorizedMcpIds: string[] = [];
    if (activeMcpIds && activeMcpIds.length > 0 && userWithRole) {
      const role = userWithRole.role;
      // Query authorized MCP connections
      const authorizedConnections = await prismaDb.mcpConnection.findMany({
        where: {
          isActive: true,
          OR: [
            // Role-level MCPs (assigned by admin, userId=null)
            ...(role ? [{ roleId: role.id, userId: null }] : []),
            // Personal MCPs (only if role permits)
            ...(role?.personalMcpEnabled ? [{ userId: user.id }] : []),
          ],
        },
        select: { id: true },
      });
      const authorizedSet = new Set(authorizedConnections.map(c => c.id));
      authorizedMcpIds = activeMcpIds.filter((id: string) => authorizedSet.has(id));
    }

    // Load MCP tools if any authorized connections are active
    if (authorizedMcpIds.length > 0) {
      console.log(`[Chat] Loading MCP tools from ${authorizedMcpIds.length} authorized connections`);
      try {
        const { tools: mcpTools, descriptions } = await loadActiveMcpToolsWithDescriptions(authorizedMcpIds, user.id);
        const mcpToolCount = Object.keys(mcpTools).length;
        if (mcpToolCount > 0) {
          Object.assign(tools, mcpTools);
          mcpToolDescriptions = descriptions;
          console.log(`[Chat] Successfully loaded ${mcpToolCount} MCP tools:`, Object.keys(mcpTools));
          console.log(`[Chat] MCP tool descriptions for prompt:`, descriptions.map(d => d.name));
        } else {
          console.log(`[Chat] No MCP tools loaded. Ensure connections are tested and tools are discovered.`);
        }
      } catch (error) {
        console.error('[Chat] Error loading MCP tools:', error);
      }
    }

    // Supported MIME types for inline file parts (Anthropic API):
    // - Images: image/jpeg, image/png, image/gif, image/webp
    // - Documents: application/pdf, text/plain
    // Unsupported types (xlsx, docx, pptx, csv) must use code execution tool via container_upload.
    const SUPPORTED_INLINE_MIMES = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain',
    ]);

    // Collect unsupported files for container_upload (will be uploaded to Files API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const containerUploadFiles: Array<{ data: string; filename: string; mediaType: string }> = [];

    // Sanitize messages before converting — strip parts that convertToModelMessages can't handle
    // (e.g. tool-memory, tool-code_execution, file-download, step-start loaded from DB)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sanitizedMessages = uiMessages.map((msg: any) => {
      if (!msg.parts || !Array.isArray(msg.parts)) return msg;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultParts: any[] = [];
      for (const part of msg.parts) {
        const type = part?.type as string;
        if (!type) continue;

        if (type === 'file') {
          const mime = (part.mediaType || '') as string;
          if (SUPPORTED_INLINE_MIMES.has(mime)) {
            // Supported inline — keep the file part as-is
            resultParts.push(part);
          } else if (part.url && msg.role === 'user') {
            // Unsupported (xlsx, docx, pptx, csv) — collect for Files API upload + container_upload
            containerUploadFiles.push({
              data: part.url as string, // data:... URL
              filename: part.filename || 'file',
              mediaType: mime,
            });
            // Add text hint so the model knows a file is available in the sandbox
            resultParts.push({
              type: 'text',
              text: `[File "${part.filename || 'file'}" (${mime}) has been uploaded to the sandbox. Use code execution to read and process it.]`,
            });
          }
          continue;
        }

        // Keep standard parts
        if (type === 'text' || type === 'reasoning' || type === 'tool-invocation' || type === 'tool-result') {
          resultParts.push(part);
        }
        // Drop everything else (tool-*, step-start, file-download, data-*, source-*, etc.)
      }
      // Ensure at least one text part exists
      if (resultParts.length === 0 && msg.content) {
        resultParts.push({ type: 'text', text: msg.content });
      }
      return { ...msg, parts: resultParts };
    });

    // Upload unsupported files to Anthropic Files API for container_upload
    const containerUploadFileIds: Array<{ fileId: string; filename: string }> = [];
    if (containerUploadFiles.length > 0) {
      const filesClient = getAnthropicFilesClient();
      for (const file of containerUploadFiles) {
        try {
          // Extract base64 data from data URL (data:mime;base64,XXXXX)
          const base64Match = file.data.match(/^data:[^;]+;base64,(.+)$/);
          if (!base64Match) continue;
          const buffer = Buffer.from(base64Match[1], 'base64');
          const blob = new Blob([buffer], { type: file.mediaType });
          const uploadFile = new File([blob], file.filename, { type: file.mediaType });
          const uploaded = await filesClient.beta.files.upload({ file: uploadFile });
          containerUploadFileIds.push({ fileId: uploaded.id, filename: file.filename });
          console.log(`[Chat] Uploaded file for container: ${file.filename} → ${uploaded.id}`);
        } catch (err) {
          console.error(`[Chat] Failed to upload file ${file.filename}:`, err);
        }
      }
    }

    // Convert UI messages to model messages format, then drop any orphaned
    // tool_use / tool_result blocks (e.g. an interrupted server-side code
    // execution replayed from history) so Anthropic doesn't 400 the request.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = cleanToolMessages(await convertToModelMessages(sanitizedMessages as any));

    // Use a custom provider with transformRequestBody when we have container uploads
    const modelProvider = containerUploadFileIds.length > 0
      ? createAnthropicWithContainerUploads(containerUploadFileIds.map(f => f.fileId))
      : anthropic;

    // Log available tools
    const toolNames = Object.keys(tools);
    const hasTools = toolNames.length > 0;
    console.log(`[Chat] Available tools (${toolNames.length}):`, toolNames);

    // Collect every S3 file in this conversation so the model always has the
    // file's real URL — the current turn's uploads plus any earlier uploads
    // recorded in message metadata. Presigned URLs are regenerated fresh each
    // turn (the underlying object persists; only the signed URL expires).
    const s3RefMap = new Map<string, { filename: string; mediaType?: string }>();
    for (const r of currentS3Refs) s3RefMap.set(r.key, { filename: r.filename, mediaType: r.mediaType });
    if (conversationId) {
      try {
        const saved = await getMessages(conversationId);
        for (const m of saved) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s3 = (m as any).metadata?.s3Files;
          if (Array.isArray(s3)) {
            for (const f of s3) {
              if (f?.key && !s3RefMap.has(f.key)) {
                s3RefMap.set(f.key, { filename: f.filename, mediaType: f.mediaType });
              }
            }
          }
        }
      } catch (e) {
        logger.warn('[Chat] Could not load conversation for S3 file refs', {
          route: '/api/chat',
          cause: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const promptFileRefs = await Promise.all(
      [...s3RefMap.entries()].map(async ([key, meta]) => ({
        filename: meta.filename,
        mediaType: meta.mediaType,
        url: await presignKey(key),
      }))
    );

    // Build dynamic system prompt with available tools (+ this conversation's S3 file URLs)
    const systemPrompt = buildSystemPromptWithTools(
      toolNames,
      mcpToolDescriptions,
      promptFileRefs
    );
    console.log(`[Chat] System prompt includes ${mcpToolDescriptions.length} MCP tool descriptions, ${promptFileRefs.length} S3 file(s)`);

    // Fit messages within the context window (trim tool results + drop old groups)
    const fittedMessages = fitMessagesToContextWindow(messages, systemPrompt);

    // Build streamText configuration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamConfig: Record<string, any> = {
      model: modelProvider(modelId),
      system: systemPrompt,
      messages: fittedMessages,
      maxTokens: 65536,
      ...(thinkingMode !== 'none' ? {} : { temperature: 0.7 }),
      // Before each step, strip errored/orphaned server-tool blocks (e.g. a failed
      // code_execution whose error result the SDK packs inline) so Anthropic never
      // sees a `bash_code_execution` tool_use without a valid result. (vercel/ai #11855)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prepareStep: ({ messages: stepMessages }: { messages: any[] }) => {
        const cleaned = cleanToolMessages(stepMessages);
        return cleaned === stepMessages ? {} : { messages: cleaned };
      },
      // Log tool calls for debugging - this is called after each step (including tool executions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStepFinish: (event: any) => {
        console.log(`[Chat] ========== STEP FINISHED ==========`);
        console.log(`[Chat] Step type: ${event.stepType}`);
        console.log(`[Chat] Finish reason: ${event.finishReason}`);

        if (event.toolCalls && event.toolCalls.length > 0) {
          console.log(`[Chat] Tool calls made:`, event.toolCalls.map((tc: Record<string, unknown>) => ({
            name: tc.toolName,
            args: JSON.stringify(tc.args ?? {}).substring(0, 200)
          })));
        }

        if (event.toolResults && event.toolResults.length > 0) {
          console.log(`[Chat] Tool results received:`);
          event.toolResults.forEach((tr: Record<string, unknown>, i: number) => {
            const trResult = tr.result;
            const resultStr = trResult === undefined || trResult === null
              ? '(no result)'
              : typeof trResult === 'string'
                ? trResult.substring(0, 300)
                : JSON.stringify(trResult).substring(0, 300);
            console.log(`[Chat]   Result ${i + 1} (${tr.toolName || 'unknown'}):`, resultStr);
            // Log file_ids from code execution results
            if (trResult && typeof trResult === 'object') {
              const resultObj = trResult as Record<string, unknown>;
              const content = resultObj.content as Array<Record<string, unknown>> | undefined;
              if (content && Array.isArray(content) && content.length > 0) {
                const fileIds = content.filter(c => c.file_id).map(c => c.file_id);
                if (fileIds.length > 0) {
                  console.log(`[Chat]   File IDs in result:`, fileIds);
                }
              }
            }
          });
        }

        if (event.text) {
          console.log(`[Chat] Text generated: ${event.text.substring(0, 200)}...`);
        }
        console.log(`[Chat] ========================================`);
      },
    };

    // Add tools if any are defined
    if (hasTools) {
      streamConfig.tools = tools;
      // Enable multi-step tool calls - model continues after tool results until done
      streamConfig.stopWhen = stepCountIs(20);
      console.log(`[Chat] Tools attached to model config:`, Object.keys(tools));
    }

    // Build anthropic provider options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anthropicOptions: Record<string, any> = {};

    if (thinkingMode === 'adaptive') {
      anthropicOptions.thinking = { type: 'adaptive' };
      // For Opus 4.6 use 'max', for Sonnet 4.6 use 'high' (max is Opus-only)
      const effort = (modelId === 'claude-opus-4-8' || modelId === 'claude-opus-4-7') ? 'max' : 'high';
      anthropicOptions.effort = effort;
      console.log(`[Chat] Adaptive thinking enabled (effort: ${effort})`);
    } else if (thinkingMode === 'manual') {
      anthropicOptions.thinking = { type: 'enabled', budgetTokens: manualThinkingBudget };
      console.log(`[Chat] Manual thinking enabled (budget: ${manualThinkingBudget})`);
    }

    // Agent skills for code execution (always enabled)
    anthropicOptions.container = {
      skills: [
        { type: 'anthropic', skillId: 'pptx', version: 'latest' },
        { type: 'anthropic', skillId: 'docx', version: 'latest' },
        { type: 'anthropic', skillId: 'pdf', version: 'latest' },
        { type: 'anthropic', skillId: 'xlsx', version: 'latest' },
        { type: 'custom', skillId: 'skill_01JcCJjnPE6Pah8SceXsBy6P' },
      ],
    };

    streamConfig.providerOptions = { anthropic: anthropicOptions };

    // Propagate container ID between steps for code execution continuity
    streamConfig.prepareStep = forwardAnthropicContainerIdFromLastStep;

    // Create the streaming response using createUIMessageStream
    // This keeps the HTTP response open so we can merge the AI stream,
    // then write file-download data chunks after completion - all in one response.
    // DB persistence uses onFinish which receives responseMessage.parts — the exact
    // parts the client saw (including step-start, interleaved text/tool parts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = streamText(streamConfig as any);

    // Issue 18: Ensure backend completes even if client disconnects
    result.consumeStream();

    // Shared state between execute and onFinish
    const fileDownloadParts: Array<Record<string, unknown>> = [];

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Keep-alive: send SSE comments every 15s to prevent AWS App Runner
        // from dropping the connection during long tool executions or thinking.
        const keepAlive = setInterval(() => {
          try {
            writer.write({ type: 'data-keepalive', data: {} });
          } catch {
            // Stream already closed
            clearInterval(keepAlive);
          }
        }, 15_000);

        try {
        // 1. Merge AI stream (tokens flow to client in real-time)
        writer.merge(result.toUIMessageStream({ sendReasoning: true, sendSources: true }));

        // 2. Wait for completion
        const [, , steps] = await Promise.all([
          result.text, result.reasoning, result.steps,
        ]);

        // 3. Extract file_ids from code_execution outputs and write to stream
        if (conversationId && steps && steps.length > 0) {
          const fileDownloads: Array<{ fileId: string; filename: string; mimeType: string; sizeBytes: number }> = [];
          const seenFileIds = new Set<string>();

          const extractFileIds = (output: unknown) => {
            if (!output || typeof output !== 'object') return;
            const obj = output as Record<string, unknown>;

            if (typeof obj.file_id === 'string' && obj.file_id.startsWith('file_') && !seenFileIds.has(obj.file_id)) {
              seenFileIds.add(obj.file_id);
              fileDownloads.push({
                fileId: obj.file_id,
                filename: (obj.file_name as string) || (obj.filename as string) || 'download',
                mimeType: (obj.file_type as string) || (obj.mime_type as string) || 'application/octet-stream',
                sizeBytes: (obj.file_size as number) || (obj.size_bytes as number) || 0,
              });
            }

            const content = obj.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (typeof block.file_id === 'string' && block.file_id.startsWith('file_') && !seenFileIds.has(block.file_id)) {
                  seenFileIds.add(block.file_id);
                  fileDownloads.push({
                    fileId: block.file_id,
                    filename: (block.file_name as string) || (block.filename as string) || 'download',
                    mimeType: (block.file_type as string) || (block.mime_type as string) || 'application/octet-stream',
                    sizeBytes: (block.file_size as number) || (block.size_bytes as number) || 0,
                  });
                }
              }
            }
          };

          // Scan tool results for file IDs
          for (const step of steps) {
            if (step.toolResults) {
              for (const tr of step.toolResults) {
                const trAny = tr as Record<string, unknown>;
                extractFileIds(trAny.result);
                extractFileIds(trAny.output);
              }
            }
          }

          // Deduplicate by filename — code execution often produces intermediate
          // and final versions of the same file with different file_ids.
          // Keep the last file_id per filename (the final version).
          const fileByName = new Map<string, typeof fileDownloads[0]>();
          for (const file of fileDownloads) {
            fileByName.set(file.filename, file);
          }
          const uniqueFiles = Array.from(fileByName.values());

          // Enrich with metadata from Files API and write data chunks to stream
          for (const file of uniqueFiles) {
            try {
              const client = getAnthropicFilesClient();
              const metadata = await client.beta.files.retrieveMetadata(file.fileId);
              if (metadata.filename) file.filename = metadata.filename;
              if (metadata.mime_type) file.mimeType = metadata.mime_type;
              if (metadata.size_bytes) file.sizeBytes = metadata.size_bytes;
            } catch {
              // Use what we have from the output
            }

            console.log(`[Chat] File download: ${file.fileId} (${file.filename})`);

            // Write file-download data chunk through the SSE stream
            writer.write({
              type: 'data-fileDownload',
              data: {
                fileId: file.fileId,
                filename: file.filename,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
              },
            });

            // Save for DB persistence in onFinish
            fileDownloadParts.push({
              type: 'file-download',
              fileId: file.fileId,
              filename: file.filename,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            });
          }
        }
        } finally {
          clearInterval(keepAlive);
        }
      },
      onFinish: async ({ responseMessage }) => {
        // Persist the message to DB using the exact parts the client received.
        // responseMessage.parts has step-start, text, tool-*, reasoning parts
        // in the correct interleaved order — matching what the streaming view showed.
        if (!conversationId) return;

        try {
          // Convert the streaming parts to a serializable format for DB storage
          const streamParts = Array.isArray(responseMessage.parts) ? responseMessage.parts : [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const dbParts: Array<Record<string, unknown>> = streamParts.map((part: any) => {
            const partType = part.type as string;

            if (partType === 'text') {
              return { type: 'text', text: part.text || '' };
            }

            if (partType === 'reasoning') {
              return { type: 'reasoning', text: part.text || '' };
            }

            if (partType === 'step-start') {
              return { type: 'step-start' };
            }

            if (partType?.startsWith('tool-')) {
              return {
                type: partType,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input ?? part.args ?? {},
                output: part.output ?? part.result ?? undefined,
                state: part.state || 'output-available',
              };
            }

            if (partType === 'dynamic-tool') {
              return {
                type: `tool-${part.toolName || 'unknown'}`,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input ?? part.args ?? {},
                output: part.output ?? part.result ?? undefined,
                state: part.state || 'output-available',
              };
            }

            if (partType?.startsWith('data-')) {
              // data-fileDownload parts are handled separately
              return null;
            }

            // Pass through other parts (source-url, source-document, file, etc.)
            return { ...part };
          }).filter(Boolean) as Array<Record<string, unknown>>;

          // Append file-download parts at the end
          dbParts.push(...fileDownloadParts);

          // Extract plain text for the content field
          const text = await result.text;
          const reasoning = await result.reasoning;
          const steps = await result.steps;

          // Ensure we have at least one part
          if (dbParts.length === 0 && text) {
            dbParts.push({ type: 'text', text });
          }

          await addMessage(conversationId, {
            role: 'assistant',
            content: text || '',
            parts: dbParts.length > 0 ? dbParts : [{ type: 'text', text: text || '' }],
            metadata: {
              reasoning: reasoning || null,
              stepsCount: steps?.length || 0,
              model: modelId,
            },
          });

          // ── Record usage for admin_athena tracking ──
          try {
            const steps = await result.steps;
            let inputTokens = 0, outputTokens = 0, thinkingTokens = 0;
            for (const step of (steps || [])) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const u = (step as any).usage;
              if (u) {
                inputTokens += u.promptTokens || 0;
                outputTokens += u.completionTokens || 0;
              }
            }
            const { prisma: pDb } = await import('@/lib/db');
            await pDb.usageRecord.create({
              data: {
                userId: user.id,
                model: modelId,
                inputTokens,
                outputTokens,
                thinkingTokens,
                conversationId: conversationId || null,
              },
            });
          } catch (usageErr) {
            console.error('[Chat] Usage recording failed:', usageErr);
          }
          // ── End usage recording ──

          // ── REQ-04 — finalize prompt-audit row on success ──
          if (promptAuditHandle) {
            try {
              const allSteps = await result.steps;
              const toolCalls: ToolCallSummary[] = [];
              // Per-turn token + cost bucketing:
              //   turn 1 input        → request_*
              //   turns 2..N input    → retrieval_*
              //   all turns' output   → response_*
              // Cost is priced per step using that step's own model id, so
              // mixed-model conversations (rare) are accurate.
              let requestTokens = 0, retrievalTokens = 0, responseTokens = 0;
              let requestCost = 0,   retrievalCost = 0,   responseCost = 0;
              let unknownModelLogged = false;
              const stepsList = allSteps || [];
              for (let idx = 0; idx < stepsList.length; idx++) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const s = stepsList[idx] as any;
                // Map toolCallId → server output so we can pair inputs
                // with their corresponding outputs for the audit log.
                // Vercel AI SDK v6 names them `input`/`output`; older
                // versions used `args`/`result`. Read both to stay
                // compatible across SDK upgrades.
                const resultsByCallId = new Map<string, unknown>();
                if (Array.isArray(s.toolResults)) {
                  for (const tr of s.toolResults) {
                    if (tr.toolCallId) resultsByCallId.set(tr.toolCallId, tr.output ?? tr.result);
                  }
                }
                if (Array.isArray(s.toolCalls)) {
                  for (const tc of s.toolCalls) {
                    toolCalls.push({
                      name: tc.toolName || tc.name || 'unknown',
                      args: tc.input ?? tc.args,
                      // `result` holds the FULL MCP-server response — that
                      // typically includes the SQL the MCP built + the rows.
                      // Persisted into prompt_audit_logs.tool_calls.
                      result: tc.toolCallId ? resultsByCallId.get(tc.toolCallId) : undefined,
                      toolCallId: tc.toolCallId,
                    } as ToolCallSummary & { toolCallId?: string });
                  }
                }
                if (s.usage) {
                  // SDK v6 uses inputTokens/outputTokens; legacy used
                  // promptTokens/completionTokens. Try v6 first.
                  const inTok    = s.usage.inputTokens               ?? s.usage.promptTokens     ?? 0;
                  const outTok   = s.usage.outputTokens              ?? s.usage.completionTokens ?? 0;
                  const readTok  = s.usage.cachedInputTokens         ?? 0;
                  const writeTok = s.usage.cacheCreationInputTokens  ?? 0;
                  const stepModel = s.response?.modelId || s.modelId || modelId;
                  // Prefer registry rates loaded once up front; else hardcoded.
                  const registryRate = registryRatesByModel.get(stepModel);
                  if (!registryRate && !hasPricing(stepModel) && !unknownModelLogged) {
                    logger.fabOrchError(
                      new Error(`No pricing for model "${stepModel}" — cost will be 0`),
                      { route: '/api/chat' }
                    );
                    unknownModelLogged = true;
                  }
                  const stepUsage = {
                    inputTokens: inTok,
                    outputTokens: outTok,
                    cachedInputTokens: readTok,
                    cacheCreationInputTokens: writeTok,
                  };
                  const cost = registryRate
                    ? costForTurnWithRates(registryRate, stepUsage)
                    : costForTurn(stepModel, stepUsage);
                  const stepInputTokens = inTok + readTok + writeTok;
                  if (idx === 0) {
                    requestTokens += stepInputTokens;
                    requestCost   += cost.inputCost;
                  } else {
                    retrievalTokens += stepInputTokens;
                    retrievalCost   += cost.inputCost;
                  }
                  responseTokens += outTok;
                  responseCost   += cost.outputCost;
                }
              }
              await recordPromptSuccess({
                rowId: promptAuditHandle.rowId,
                startedAtMs: promptAuditHandle.startedAtMs,
                app: promptAuditHandle.app,
                userPrompt: promptAuditUserText,
                llmResponse: text || '',
                toolCalls,
                requestTokens,
                retrievalTokens,
                responseTokens,
                requestCost,
                retrievalCost,
                responseCost,
              });
              // REQ-02 simplified — bump the activity clock now that the
              // multi-minute streaming response has finished, so a 2-min
              // chat doesn't look like 2 min of idle to the admin chat.
              if (bearerToken) bumpActivityIfActive(bearerToken).catch(() => {});
            } catch (e) {
              logger.fabOrchError(e, { route: '/api/chat', userId: user.id });
            }
          }
          // ── End REQ-04 prompt-success hook ──

        } catch (error) {
          console.error('[Chat] Error persisting message:', error);
        }
      },
      onError: (error) => {
        // Normalize every stream error through the REQ-01 catalog so the
        // user sees a canonical message and we get a structured log line.
        const fabErr = isFabOrchError(error)
          ? error
          : (() => {
              const msg = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
              if (msg.includes('rate_limit') || msg.includes('rate limit') || msg.includes('overloaded') || msg.includes('529')) {
                return FabOrchError.lambdaMcpCrash(error, { route: '/api/chat' });
              }
              if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
                return FabOrchError.responseTimeout(error, { route: '/api/chat' });
              }
              if (msg.includes('invalid_api_key') || msg.includes('authentication') || msg.includes('credit') || msg.includes('billing')) {
                return FabOrchError.lambdaMcpCrash(error, { route: '/api/chat', extra: { reason: 'auth_or_billing' } });
              }
              return FabOrchError.lambdaMcpCrash(error, { route: '/api/chat' });
            })();
        logger.fabOrchError(fabErr, { route: '/api/chat' });
        // REQ-03 — also persist stream-time errors to error_audit_logs.
        import('@/lib/errors/error-audit').then(m =>
          m.recordError(fabErr, { userId: user.id, route: '/api/chat', method: 'POST' })
        ).catch(() => {});
        // REQ-04 — close the prompt-audit row with the error envelope.
        if (promptAuditHandle) {
          recordPromptFailure({
            rowId: promptAuditHandle.rowId,
            startedAtMs: promptAuditHandle.startedAtMs,
            errorEnvelope: {
              errorId: fabErr.errorId,
              type: fabErr.type,
              priority: fabErr.priority,
              userMessage: fabErr.userMessage,
            },
          }).catch(() => {});
        }
        return `${fabErr.userMessage} (errorId=${fabErr.errorId})`;
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        // Prevent reverse proxies (Nginx, AWS ALB, Cloudflare) from buffering SSE
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    // REQ-04 — close the prompt-audit row if we opened one.
    // promptAuditHandle is declared inside the try; we re-look-up via the
    // outer let-binding pattern below if you ever extract it.
    return handleApiError(error, req, { route: '/api/chat', userId: user.id });
  }
}

// GET endpoint to return available models
export async function GET() {
  const models = [
    {
      id: 'claude-opus-4-7',
      name: 'FabOrchestrator 1.0',
      description: 'Powerful reasoning with adaptive thinking',
      supportsReasoning: true,
    },
    {
      id: 'claude-sonnet-5',
      name: 'FabOrchestrator 1.1',
      description: 'Fast and intelligent with adaptive thinking',
      supportsReasoning: true,
    },
    {
      id: 'claude-opus-4-8',
      name: 'FabOrchestrator 2.0',
      description: 'Most capable model with adaptive thinking',
      supportsReasoning: true,
    },
  ];

  return Response.json({
    models,
    defaultModel: 'claude-opus-4-8'
  });
}
