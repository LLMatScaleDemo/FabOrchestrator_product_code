import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import prisma from '@/lib/db';
import { decrypt } from '@/lib/encryption';

// POST /api/mcp/connections/[id]/test - Test connection to MCP server
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const { id } = await params;
    const connection = await prisma.mcpConnection.findUnique({ where: { id } });

    if (!connection) {
      return NextResponse.json(
        { error: 'MCP connection not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (connection.userId !== user.id) {
      return NextResponse.json(
        { error: 'Not authorized to test this MCP connection' },
        { status: 403 }
      );
    }

    // Prepare headers for authentication
    // MCP servers require Accept header for both JSON and SSE (Server-Sent Events)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    if (connection.authCredentialsEncrypted) {
      try {
        const credentials = JSON.parse(decrypt(connection.authCredentialsEncrypted));

        if (connection.authType === 'api_key' && credentials.apiKey) {
          headers['Authorization'] = `Bearer ${credentials.apiKey}`;
        }
        // OAuth flow would be more complex - simplified for now
      } catch (decryptError) {
        console.error('Error decrypting credentials:', decryptError);
      }
    }

    // Helper function to parse SSE or JSON response
    const parseResponse = async (response: Response): Promise<unknown> => {
      const contentType = response.headers.get('content-type') || '';
      console.log('[MCP Parse] Content-Type:', contentType);

      if (contentType.includes('application/json')) {
        const json = await response.json();
        console.log('[MCP Parse] JSON response:', JSON.stringify(json).slice(0, 500));
        return json;
      }

      if (contentType.includes('text/event-stream')) {
        const text = await response.text();
        console.log('[MCP Parse] SSE raw text:', text.slice(0, 1000));
        const lines = text.split('\n');
        let lastData: unknown = null;

        for (const line of lines) {
          // Handle both "data:" and "data: " formats
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            console.log('[MCP Parse] SSE data line:', jsonStr.slice(0, 200));
            if (jsonStr && jsonStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(jsonStr);
                lastData = parsed;
                console.log('[MCP Parse] Parsed SSE JSON:', JSON.stringify(parsed).slice(0, 300));
              } catch (parseErr) {
                console.log('[MCP Parse] Failed to parse SSE line:', parseErr);
              }
            }
          }
        }

        if (lastData) return lastData;

        // If no data: lines found, try parsing the entire text as JSON
        try {
          const fallback = JSON.parse(text);
          console.log('[MCP Parse] Fallback JSON parse succeeded');
          return fallback;
        } catch {
          console.log('[MCP Parse] No valid JSON found in SSE stream');
        }

        throw new Error('No valid JSON-RPC response in SSE stream');
      }

      // Fallback: try to parse as JSON
      const text = await response.text();
      console.log('[MCP Parse] Unknown content-type, raw text:', text.slice(0, 500));
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Unable to parse response: ${text.slice(0, 200)}`);
      }
    };

    // Attempt to connect to the MCP server
    // MCP uses JSON-RPC 2.0 over HTTP with optional SSE streaming
    try {
      const response = await fetch(connection.serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            clientInfo: {
              name: 'llmatscale-ai',
              version: '1.0.0',
            },
          },
        }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        await prisma.mcpConnection.update({
          where: { id },
          data: {
            status: 'error',
            lastError: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
            isActive: false,
          },
        });

        return NextResponse.json({
          success: false,
          status: 'error',
          error: `Server returned ${response.status}`,
        });
      }

      // Capture session ID from response headers (MCP session management)
      const sessionId = response.headers.get('mcp-session-id') || response.headers.get('x-session-id');
      console.log('[MCP Test] Session ID from headers:', sessionId);

      const result = await parseResponse(response) as { error?: { message?: string }; result?: { serverInfo?: unknown } };

      // Check for JSON-RPC error
      if (result.error) {
        await prisma.mcpConnection.update({
          where: { id },
          data: {
            status: 'error',
            lastError: result.error.message || 'Unknown MCP error',
            isActive: false,
          },
        });

        return NextResponse.json({
          success: false,
          status: 'error',
          error: result.error.message,
        });
      }

      // Success - update connection status and store session ID
      await prisma.mcpConnection.update({
        where: { id },
        data: {
          status: 'connected',
          lastError: null,
          isActive: true,
          lastConnectedAt: new Date(),
          ...(sessionId && { sessionId }),
        },
      });

      // Auto-discover tools after successful connection
      let discoveredTools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
      try {
        console.log('[MCP Test] Discovering tools from:', connection.serverUrl);
        console.log('[MCP Test] Using session ID:', sessionId);

        // Build headers for tools/list request, including session ID if present
        const toolsHeaders: Record<string, string> = { ...headers };
        if (sessionId) {
          toolsHeaders['Mcp-Session-Id'] = sessionId;
        }

        const toolsResponse = await fetch(connection.serverUrl, {
          method: 'POST',
          headers: toolsHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }),
          signal: AbortSignal.timeout(10000),
        });

        console.log('[MCP Test] tools/list response status:', toolsResponse.status);
        console.log('[MCP Test] tools/list content-type:', toolsResponse.headers.get('content-type'));

        if (toolsResponse.ok) {
          const toolsResult = await parseResponse(toolsResponse);
          console.log('[MCP Test] Parsed tools result:', JSON.stringify(toolsResult, null, 2));

          // Handle different response structures
          const typedResult = toolsResult as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };

          // Try result.tools first, then tools directly (some servers return tools at root level)
          const tools = typedResult.result?.tools || typedResult.tools;

          if (tools && Array.isArray(tools)) {
            console.log('[MCP Test] Found', tools.length, 'tools');
            // Log each tool's schema for debugging
            tools.forEach((t, i) => {
              console.log(`[MCP Test] Tool ${i + 1}: ${t.name}`);
              console.log(`[MCP Test]   Description: ${t.description || '(none)'}`);
              console.log(`[MCP Test]   InputSchema:`, JSON.stringify(t.inputSchema, null, 2));
            });

            discoveredTools = tools.map((t) => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema || {},
            }));

            // Store discovered tools
            await prisma.mcpConnection.update({
              where: { id },
              data: { availableTools: discoveredTools as any },
            });
            console.log('[MCP Test] Stored tools in database');
          } else {
            console.log('[MCP Test] No tools array found in response');
          }
        } else {
          const errorText = await toolsResponse.text();
          console.log('[MCP Test] tools/list failed:', errorText);
        }
      } catch (toolError) {
        console.error('[MCP Test] Tool discovery error:', toolError);
      }

      return NextResponse.json({
        success: true,
        status: 'connected',
        serverInfo: result.result?.serverInfo || null,
        tools: discoveredTools,
        toolCount: discoveredTools.length,
      });
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Connection failed';

      await prisma.mcpConnection.update({
        where: { id },
        data: {
          status: 'error',
          lastError: errorMessage,
          isActive: false,
        },
      });

      return NextResponse.json({
        success: false,
        status: 'error',
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error('Error testing MCP connection:', error);
    return NextResponse.json(
      { error: 'Failed to test MCP connection' },
      { status: 500 }
    );
  }
}
