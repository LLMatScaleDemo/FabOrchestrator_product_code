/**
 * MCP (Model Context Protocol) Client
 * Handles connection to MCP servers and tool execution
 */

import { getMcpConnection } from './storage';
import { decrypt } from './encryption';
import { tool } from 'ai';
import { z } from 'zod';
import {
  FabOrchError,
  isFabOrchError,
} from './errors/faborch-errors';
import { logger } from './logger';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Get authentication headers for an MCP connection
 */
async function getAuthHeaders(connectionId: string): Promise<{ headers: Record<string, string>; sessionId?: string | null }> {
  const connection = await getMcpConnection(connectionId);

  if (!connection) {
    throw new Error('MCP connection not found');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  // Add session ID for stateful MCP servers
  if (connection.sessionId) {
    headers['Mcp-Session-Id'] = connection.sessionId;
  }

  if (connection.authCredentialsEncrypted) {
    try {
      const credentials = JSON.parse(decrypt(connection.authCredentialsEncrypted));

      if (connection.authType === 'api_key' && credentials.apiKey) {
        headers['Authorization'] = `Bearer ${credentials.apiKey}`;
      }
      // OAuth would require token refresh flow - simplified here
    } catch (error) {
      console.error('Error decrypting MCP credentials:', error);
    }
  }

  return { headers, sessionId: connection.sessionId };
}

/**
 * Parse SSE (Server-Sent Events) response stream
 * Returns the final JSON-RPC result from the event stream
 */
async function parseSSEResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';

  // If it's regular JSON, parse directly
  if (contentType.includes('application/json')) {
    return response.json();
  }

  // If it's SSE, parse the event stream
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    const lines = text.split('\n');

    let lastData: unknown = null;

    for (const line of lines) {
      // SSE format: "data: {json}"
      if (line.startsWith('data:')) {
        const jsonStr = line.slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            lastData = JSON.parse(jsonStr);
          } catch {
            // Skip non-JSON data lines
          }
        }
      }
    }

    if (lastData) {
      return lastData;
    }

    throw new Error('No valid JSON-RPC response found in SSE stream');
  }

  // Fallback: try to parse as JSON anyway
  return response.json();
}

/**
 * Re-initialize MCP connection to get a new session ID
 */
async function refreshMcpSession(connectionId: string): Promise<string | null> {
  const connection = await getMcpConnection(connectionId);
  if (!connection) return null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  // Add auth if configured
  if (connection.authCredentialsEncrypted) {
    try {
      const credentials = JSON.parse(decrypt(connection.authCredentialsEncrypted));
      if (connection.authType === 'api_key' && credentials.apiKey) {
        headers['Authorization'] = `Bearer ${credentials.apiKey}`;
      }
    } catch (error) {
      console.error('[MCP] Error decrypting credentials for session refresh:', error);
    }
  }

  try {
    console.log('[MCP] Refreshing session for connection:', connectionId);
    const response = await fetch(connection.serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'llmatscale-ai', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error('[MCP] Session refresh failed:', response.status);
      return null;
    }

    // Get new session ID from headers
    const newSessionId = response.headers.get('mcp-session-id') || response.headers.get('x-session-id');

    if (newSessionId) {
      // Update session ID in database
      const { updateMcpConnection } = await import('./storage');
      await updateMcpConnection(connectionId, { sessionId: newSessionId });
      console.log('[MCP] Session refreshed successfully:', newSessionId);
      return newSessionId;
    }

    return null;
  } catch (error) {
    console.error('[MCP] Session refresh error:', error);
    return null;
  }
}

/**
 * Check if error indicates session expiry
 */
function isSessionExpiredError(error: string): boolean {
  const sessionErrors = [
    'missing session',
    'invalid session',
    'session expired',
    'session not found',
    'unauthorized',
    'session id',
  ];
  const lowerError = error.toLowerCase();
  return sessionErrors.some(se => lowerError.includes(se));
}

/**
 * Execute a tool on an MCP server with automatic session refresh
 */
export async function executeMcpTool(
  connectionId: string,
  toolName: string,
  toolArguments: Record<string, unknown>,
  userId: string | null = null
): Promise<McpToolResult> {
  const connection = await getMcpConnection(connectionId);

  if (!connection) {
    throw new Error('MCP connection not found');
  }

  if (connection.status !== 'connected') {
    throw new Error('MCP connection is not active');
  }

  // Try to execute tool, with automatic session refresh on expiry
  const executeWithRetry = async (retryCount: number = 0): Promise<McpToolResult> => {
    const { headers } = await getAuthHeaders(connectionId);

    try {
      const response = await fetch(connection.serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolArguments,
          },
        }),
        signal: AbortSignal.timeout(30000), // 30 second timeout for tool execution
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check if session expired and retry once
        if (retryCount === 0 && isSessionExpiredError(errorText)) {
          console.log('[MCP] Session expired, attempting refresh...');
          const newSessionId = await refreshMcpSession(connectionId);
          if (newSessionId) {
            return executeWithRetry(1);
          }
        }

        // Classify into REQ-01 categories for structured logging.
        const fabErr = response.status >= 500
          ? FabOrchError.lambdaMcpCrash(new Error(`HTTP ${response.status}: ${errorText}`), {
              toolName, route: connection.serverUrl, extra: { httpStatus: response.status },
            })
          : response.status === 404
          ? FabOrchError.unlistedStoredProc(toolName, { route: connection.serverUrl })
          : response.status === 400
          ? FabOrchError.invalidParameter(toolName, undefined, new Error(errorText), {
              httpStatus: response.status,
            })
          : FabOrchError.lambdaMcpCrash(new Error(`HTTP ${response.status}: ${errorText}`), {
              toolName, route: connection.serverUrl, extra: { httpStatus: response.status },
            });
        logger.fabOrchError(fabErr);
        import('./errors/error-audit').then(m =>
          m.recordError(fabErr, { userId, route: connection.serverUrl, method: 'POST' })
        ).catch(() => {});

        return {
          content: [{ type: 'text', text: `${fabErr.userMessage} (errorId=${fabErr.errorId})` }],
          isError: true,
        };
      }

      // Parse response (handles both JSON and SSE)
      const result = await parseSSEResponse(response) as { error?: { message?: string; code?: number }; result?: McpToolResult };

      if (result.error) {
        // Check if session expired and retry once
        if (retryCount === 0 && isSessionExpiredError(result.error.message || '')) {
          console.log('[MCP] Session expired (from response), attempting refresh...');
          const newSessionId = await refreshMcpSession(connectionId);
          if (newSessionId) {
            return executeWithRetry(1);
          }
        }

        const errMsg = result.error.message || 'MCP tool execution failed';
        const code = result.error.code;
        // JSON-RPC -32601 = Method not found, -32602 = Invalid params
        const fabErr = code === -32601
          ? FabOrchError.unlistedStoredProc(toolName, { route: connection.serverUrl })
          : code === -32602
          ? FabOrchError.invalidParameter(toolName, undefined, new Error(errMsg))
          : FabOrchError.lambdaMcpCrash(new Error(errMsg), {
              toolName, route: connection.serverUrl, extra: { jsonRpcCode: code },
            });
        logger.fabOrchError(fabErr);
        import('./errors/error-audit').then(m =>
          m.recordError(fabErr, { userId, route: connection.serverUrl, method: 'POST' })
        ).catch(() => {});

        return {
          content: [{ type: 'text', text: `${fabErr.userMessage} (errorId=${fabErr.errorId})` }],
          isError: true,
        };
      }

      return result.result || { content: [{ type: 'text', text: 'No result returned' }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if session expired and retry once
      if (retryCount === 0 && isSessionExpiredError(errorMessage)) {
        console.log('[MCP] Session expired (from exception), attempting refresh...');
        const newSessionId = await refreshMcpSession(connectionId);
        if (newSessionId) {
          return executeWithRetry(1);
        }
      }

      const errName = error instanceof Error ? error.name : '';
      const fabErr = errName === 'AbortError' || errName === 'TimeoutError'
        ? FabOrchError.responseTimeout(error, {
            toolName, route: connection.serverUrl,
          })
        : FabOrchError.lambdaMcpCrash(error, {
            toolName, route: connection.serverUrl,
          });
      logger.fabOrchError(fabErr);

      return {
        content: [{ type: 'text', text: `${fabErr.userMessage} (errorId=${fabErr.errorId})` }],
        isError: true,
      };
    }
  };

  return executeWithRetry(0);
}

/**
 * Get tools from an MCP connection
 */
export async function getMcpTools(connectionId: string): Promise<McpTool[]> {
  console.log(`[MCP] getMcpTools called for connectionId: ${connectionId}`);
  const connection = await getMcpConnection(connectionId);

  if (!connection) {
    console.log(`[MCP] Connection ${connectionId} NOT FOUND in database`);
    return [];
  }

  console.log(`[MCP] Found connection: name='${connection.name}', status='${connection.status}', isActive=${connection.isActive}`);

  if (connection.status !== 'connected') {
    console.log(`[MCP] Connection '${connection.name}' status is '${connection.status}', not 'connected'. Tools will not be loaded.`);
    console.log(`[MCP] To use this connection, test it first via Settings > MCP Connections`);
    return [];
  }

  // Return cached tools
  const availableTools = connection.availableTools as unknown;
  console.log(`[MCP] availableTools type: ${typeof availableTools}, isArray: ${Array.isArray(availableTools)}`);

  if (Array.isArray(availableTools)) {
    console.log(`[MCP] availableTools has ${availableTools.length} items`);
    if (availableTools.length > 0) {
      console.log(`[MCP] First tool:`, JSON.stringify(availableTools[0]));
      console.log(`[MCP] Loaded ${availableTools.length} tools from connection '${connection.name}'`);
      return availableTools as McpTool[];
    }
  }

  console.log(`[MCP] Connection '${connection.name}' has no discovered tools. Run tool discovery first.`);
  return [];
}

/**
 * Convert MCP tools to AI SDK tool format
 * Creates Vercel AI SDK compatible tools from MCP tool definitions
 */
export function convertMcpToolsToAiTools(
  mcpTools: McpTool[],
  connectionId: string,
  userId: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiTools: Record<string, any> = {};

  for (const mcpTool of mcpTools) {
    // Build Zod schema from MCP tool input schema
    const zodSchema = buildZodSchema(mcpTool.inputSchema);

    // Create a safe tool name (replace special chars)
    const safeName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_');
    const toolKey = `mcp_${safeName}`;

    console.log(`[MCP] Converting tool: ${mcpTool.name} -> ${toolKey}`);

    aiTools[toolKey] = tool({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      inputSchema: zodSchema,
      execute: async (args) => {
        console.log(`[MCP] ========== TOOL EXECUTION START ==========`);
        console.log(`[MCP] Tool: ${mcpTool.name}`);
        console.log(`[MCP] Args:`, JSON.stringify(args, null, 2));

        try {
          const result = await executeMcpTool(connectionId, mcpTool.name, args, userId);
          console.log(`[MCP] Raw MCP result:`, JSON.stringify(result, null, 2));

          // Convert MCP result to string for AI consumption
          const textContent = result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');

          if (result.isError) {
            console.error(`[MCP] Tool ${mcpTool.name} returned error:`, textContent);
            console.log(`[MCP] ========== TOOL EXECUTION END (ERROR) ==========`);
            // Return a proper error object that the AI can understand
            return { error: textContent || 'MCP tool execution failed', isError: true };
          }

          console.log(`[MCP] Tool ${mcpTool.name} result preview:`, textContent.substring(0, 500));
          console.log(`[MCP] ========== TOOL EXECUTION END (SUCCESS) ==========`);

          // Return the result in a format the AI can process
          // Try to parse as JSON first, otherwise return as text
          try {
            const parsed = JSON.parse(textContent);
            return parsed;
          } catch {
            return { data: textContent, success: true };
          }
        } catch (error) {
          const fabErr = isFabOrchError(error)
            ? error
            : (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
              ? FabOrchError.responseTimeout(error, { toolName: mcpTool.name })
              : FabOrchError.lambdaMcpCrash(error, { toolName: mcpTool.name }));
          logger.fabOrchError(fabErr);
          import('./errors/error-audit').then(m =>
            m.recordError(fabErr, { method: 'POST', requestContext: { connectionId, toolName: mcpTool.name } })
          ).catch(() => {});
          console.error(`[MCP] Tool ${mcpTool.name} execution failed:`, fabErr.userMessage);
          console.log(`[MCP] ========== TOOL EXECUTION END (EXCEPTION) ==========`);
          return {
            error: `${fabErr.userMessage} (errorId=${fabErr.errorId})`,
            isError: true,
            type: fabErr.type,
          };
        }
      },
    });
  }

  return aiTools;
}

/**
 * Build a Zod schema from MCP tool input schema
 */
function buildZodSchema(inputSchema?: McpTool['inputSchema']): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (!inputSchema || !inputSchema.properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  const required = inputSchema.required || [];

  for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
    const prop = propSchema as { type?: string; description?: string; enum?: string[] };
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.unknown());
        break;
      case 'object':
        zodType = z.record(z.string(), z.unknown());
        break;
      default:
        zodType = z.unknown();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

/**
 * Load all active MCP tools for a conversation
 */
export async function loadActiveMcpTools(
  activeMcpIds: string[],
  userId: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const result = await loadActiveMcpToolsWithDescriptions(activeMcpIds, userId);
  return result.tools;
}

/**
 * Load all active MCP tools with their descriptions for system prompt
 * Returns both the AI SDK tools and descriptions for the LLM
 */
export async function loadActiveMcpToolsWithDescriptions(
  activeMcpIds: string[],
  userId: string | null = null
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>;
  descriptions: { name: string; description: string }[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, any> = {};
  const allDescriptions: { name: string; description: string }[] = [];

  console.log(`[MCP] loadActiveMcpToolsWithDescriptions called with ${activeMcpIds.length} connection IDs:`, activeMcpIds);

  if (!activeMcpIds || activeMcpIds.length === 0) {
    console.log('[MCP] No active MCP IDs provided, returning empty tools');
    return { tools: allTools, descriptions: allDescriptions };
  }

  for (const connectionId of activeMcpIds) {
    console.log(`[MCP] Processing connection: ${connectionId}`);
    try {
      const mcpTools = await getMcpTools(connectionId);
      console.log(`[MCP] getMcpTools returned ${mcpTools.length} tools for ${connectionId}`);

      if (mcpTools.length > 0) {
        const aiTools = convertMcpToolsToAiTools(mcpTools, connectionId, userId);
        const toolKeys = Object.keys(aiTools);
        console.log(`[MCP] Converted to AI SDK tools:`, toolKeys);
        Object.assign(allTools, aiTools);

        // Collect descriptions for the system prompt
        for (const mcpTool of mcpTools) {
          const safeName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_');
          allDescriptions.push({
            name: `mcp_${safeName}`,
            description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
          });
        }
      }
    } catch (error) {
      console.error(`[MCP] Error loading MCP tools for ${connectionId}:`, error);
    }
  }

  console.log(`[MCP] Total MCP tools loaded: ${Object.keys(allTools).length}`);
  console.log(`[MCP] Tool descriptions for prompt: ${allDescriptions.length}`);
  return { tools: allTools, descriptions: allDescriptions };
}
