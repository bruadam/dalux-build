/**
 * The MCP tool layer for hosted agents (PRD 6.11), in process: the same server, access guard, restricted
 * Dalux client and audit as a person's MCP request, reached through the SDK's HTTP handler instead of a socket.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';

import type { RequestContext } from '../access/context';
import { runWithContext } from '../access/requestScope';
import { restrictClient } from '../access/restrictedClient';
import type { Caller, Connection, Platform } from '../platform/platform';
import { buildServer } from '../server';
import { TOOLSET_NAMES } from '../toolsets';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

export interface ToolLayer {
  list(): Promise<ToolDefinition[]>;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
}

type Json = Record<string, any>;

export function toolLayer(platform: Platform, connection: Connection, caller: Caller, context: RequestContext): ToolLayer {
  const handler = createMcpHandler(
    () =>
      buildServer(restrictClient(connection.client, context, connection.folders), {
        context,
        folders: connection.folders,
        audit: (record) => platform.audit(caller, context, record),
        toolsets: TOOLSET_NAMES,
        memoryDb: platform.db,
      }),
    { onerror: (error) => console.error('[agents] tool layer error:', error) },
  );

  async function rpc(method: string, params: Json): Promise<Json> {
    const response = await runWithContext(context, () =>
      handler.fetch(
        new Request(`http://agent.invalid/mcp/c/${connection.slug}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-06-18',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      ),
    );
    const body = await response.text();
    const data = body.includes('data: ') ? body.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).at(-1)! : body;
    const message = JSON.parse(data) as { result?: Json; error?: { message: string } };
    if (message.error) throw new Error(message.error.message);
    return message.result ?? {};
  }

  return {
    async list() {
      return ((await rpc('tools/list', {})).tools ?? []) as ToolDefinition[];
    },
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args });
      const content = (result.content ?? []) as { type: string; text?: string }[];
      const text = content.map((part) => (part.type === 'text' ? (part.text ?? '') : `[${part.type} omitted]`)).join('\n');
      return { text, isError: Boolean(result.isError) };
    },
  };
}
