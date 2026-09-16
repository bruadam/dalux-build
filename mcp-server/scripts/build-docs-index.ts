#!/usr/bin/env -S npx tsx
/**
 * Builds (or refreshes) the persistent reference-docs search index — run this
 * whenever the dalux-build-docs corpus changes, or as a deploy/rebuild step
 * before restarting the server, not from inside a conversation: indexing
 * costs one OpenAI embedding call per chunk and can take minutes for a large
 * corpus, which is a bad thing to let a model trigger via a tool call. The
 * MCP server's `search_docs` tool only ever reads what this script wrote
 * (see cachePaths.docsIndexRoot — persists under ~/.dalux-mcp by default, so
 * a normal server restart doesn't lose it).
 *
 * Usage: npm run docs:build [-- --refresh]
 * Needs DOCS_GITHUB_OWNER/DOCS_GITHUB_REPO set (see mcp-server/README.md);
 * a private repo also needs DOCS_GITHUB_TOKEN or DOCS_GITHUB_USE_GH_CLI=1.
 */

// Triggers dalux-build-api's own `require('dotenv').config()` so a .env file
// in the working directory is picked up, same as the server itself — no
// DaluxClient is actually needed, the docs index never touches Dalux.
import 'dalux-build-api';

import { buildDocsIndex } from '../src/tools/docsIndex';

const refresh = process.argv.includes('--refresh');

async function main(): Promise<void> {
  const fakeClient = null as unknown as Parameters<typeof buildDocsIndex>[0];
  let pass = 0;

  for (;;) {
    pass += 1;
    const report = await buildDocsIndex(fakeClient, {
      refresh: refresh && pass === 1,
      // Generous relative to the ~120s default a live tool call budgets for —
      // this runs offline, so finishing in fewer passes matters more than
      // keeping any one call short.
      timeBudgetSeconds: 600,
      maxDocs: 2000,
    });

    console.log(
      `[pass ${pass}] mode=${report.mode} indexed=${report.docsIndexedThisPass} reused=${report.docsReused} ` +
        `removed=${report.docsRemoved} pending=${report.docsPending} chunks=${report.totalChunks} elapsed=${report.elapsedSeconds}s`,
    );
    for (const warning of report.warnings) console.warn(`  warning: ${warning}`);
    for (const failure of report.failed) console.warn(`  failed: ${failure.path} — ${failure.error}`);

    if (report.complete) {
      console.log(`Done — ${report.docsInScope} document(s) in scope, ${report.totalChunks} chunk(s) indexed.`);
      return;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
