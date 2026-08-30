#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createClient } from 'dalux-build-api';
import { buildServer } from './server';
import { buildHttpApp } from './http';

interface CliOptions {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
  token?: string;
  publicUrl?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    transport: 'stdio',
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    host: process.env.HOST ?? '127.0.0.1',
    publicUrl: process.env.PUBLIC_URL,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--transport') {
      const value = argv[++i];
      if (value !== 'stdio' && value !== 'http') {
        throw new Error(`--transport must be "stdio" or "http", got "${value}"`);
      }
      options.transport = value;
    } else if (arg === '--port') {
      options.port = Number(argv[++i]);
    } else if (arg === '--host') {
      options.host = argv[++i];
    } else if (arg === '--token') {
      options.token = argv[++i];
    } else if (arg === '--public-url') {
      options.publicUrl = argv[++i];
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.transport === 'stdio') {
    const client = createClient();
    await serveStdio(() => buildServer(client));
    console.error('dalux-mcp running on stdio');
    return;
  }

  // HTTP transport takes Dalux credentials per-request (X-Dalux-Base-Url /
  // X-Dalux-Api-Key headers from the connecting client's own MCP config),
  // not from server-side env vars — see http.ts.
  const token = options.token ?? process.env.DALUX_MCP_TOKEN;
  const localhostOnly = LOOPBACK_HOSTS.has(options.host);
  const { start } = buildHttpApp({ token, localhostOnly, publicUrl: options.publicUrl });
  await start(options.port, options.host);
  console.error(`dalux-mcp running on http://${options.host}:${options.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
