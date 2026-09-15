import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import type { ModelLinkStore } from '../modelLinks';
import { IFC_VIEWER_BUNDLE_JS } from './ifcViewerBundle.generated';

/**
 * Interactive 3D viewer for IFC models, delivered as an MCP App (SEP-1865 /
 * `ui://` resource) — the model surfaces `view_model_3d`, the host renders
 * this resource's HTML in a sandboxed iframe, and the embedded ifclite
 * viewer streams the model bytes from `GET /models/:token` (see http.ts).
 *
 * Only meaningful on the HTTP/OAuth deployment (`--public-url`): the ifclite
 * viewer needs a real URL it can fetch cross-origin, which stdio can't
 * offer. See `registerIfcViewer`'s `hosting` parameter.
 *
 * Registers directly via `server.registerResource`/`registerTool` (like
 * every other tool in server.ts) rather than through
 * `@modelcontextprotocol/ext-apps/server`'s `registerAppResource`/
 * `registerAppTool` wrappers: that package ships ESM-only with no CJS
 * build, which ts-jest can't load without adding a Babel transform just
 * for two constants and a `_meta` normalization this file does by hand
 * below. The browser-side ext-apps `App`/`PostMessageTransport` (bundled
 * by esbuild in scripts/build-ifc-viewer.mjs, see browser/ifcViewerApp.ts)
 * still uses the real package — only this Node-side registration avoids it.
 */

export const RESOURCE_URI = 'ui://dalux-build/ifc-viewer';

/** MCP Apps (SEP-1865) resource MIME type. */
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
/** Pre-2.0 hosts read the UI resource URI from this flat `_meta` key instead of `_meta.ui.resourceUri`; set both for compatibility. */
const LEGACY_RESOURCE_URI_META_KEY = 'ui/resourceUri';

/** Origin of the hosted ifclite embed viewer — must be allow-listed via the resource's CSP `frameDomains` and mirrored in http.ts's CORS headers for `/models/:token`. */
export const IFCLITE_EMBED_ORIGIN = 'https://embed.ifclite.com';

const IFC_VIEWER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<style>
html,body{margin:0;padding:0;height:100%}
#root,#viewer{width:100%;height:100%;min-height:480px}
.ifc-message{display:flex;align-items:center;justify-content:center;height:100%;min-height:480px;font:14px system-ui,sans-serif;color:#666;text-align:center;padding:16px;box-sizing:border-box}
</style>
</head>
<body>
<div id="root"></div>
<script>${IFC_VIEWER_BUNDLE_JS}</script>
</body>
</html>`;

export const viewModel3dInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z.string().describe('The file ID (must be an .ifc file).'),
});
export type ViewModel3dInput = z.infer<typeof viewModel3dInput>;

const viewModel3dOutput = z.object({
  available: z.boolean().describe('Whether a model URL was produced for the viewer.'),
  modelUrl: z.string().optional().describe('Signed URL the viewer fetches the IFC bytes from.'),
  fileName: z.string().optional(),
  message: z.string().optional().describe('Human-readable explanation when available is false.'),
});

/** Per-request Dalux credentials + infrastructure needed to serve `/models/:token`. Absent on stdio and on HTTP deployments started without `--public-url`. */
export interface IfcHostingOptions {
  publicUrl: string;
  daluxBaseUrl: string;
  daluxApiKey: string;
  modelLinks: ModelLinkStore;
}

/**
 * Registers the `view_model_3d` tool and its `ui://` resource on `server`.
 * Always registered (so `tools/list` is stable across transports) — without
 * `hosting`, the tool just explains that the viewer needs the HTTP
 * deployment instead of erroring.
 */
export function registerIfcViewer(server: McpServer, client: DaluxClient, hosting: IfcHostingOptions | undefined): void {
  server.registerResource(
    'ifc-viewer',
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: '3D viewer for IFC models, rendered by ifc-lite.',
      _meta: {
        ui: {
          csp: { frameDomains: [IFCLITE_EMBED_ORIGIN] },
          prefersBorder: true,
        },
      },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: IFC_VIEWER_HTML }],
    }),
  );

  server.registerTool(
    'view_model_3d',
    {
      title: 'View 3D Model',
      description:
        'Render an interactive 3D view of an IFC model file from a Dalux project. Only works when this server is deployed over HTTP with --public-url; use download_file over stdio instead.',
      inputSchema: viewModel3dInput,
      outputSchema: viewModel3dOutput,
      _meta: { ui: { resourceUri: RESOURCE_URI }, [LEGACY_RESOURCE_URI_META_KEY]: RESOURCE_URI },
    },
    async (args) => {
      if (!hosting) {
        const message =
          'The 3D viewer needs this Dalux MCP server running with --public-url (the HTTP/OAuth deployment) ' +
          'so the viewer can fetch model bytes over the network. Over stdio, use download_file instead.';
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { available: false, message },
        };
      }

      const fileInfo = await client.files.getFile(args.projectId, args.fileAreaId, args.fileId);
      if (typeof fileInfo === 'string' || !fileInfo) {
        const message = `File not found: ${args.fileId}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { available: false, message },
          isError: true,
        };
      }
      const data = (fileInfo as { data?: Record<string, unknown> } & Record<string, unknown>).data ?? fileInfo;
      const fileName = ((data as Record<string, unknown>).fileName as string | undefined) ?? args.fileId;
      if (!fileName.toLowerCase().endsWith('.ifc')) {
        const message = `${fileName} is not an .ifc file.`;
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { available: false, message },
          isError: true,
        };
      }

      const token = hosting.modelLinks.issue({
        daluxBaseUrl: hosting.daluxBaseUrl,
        daluxApiKey: hosting.daluxApiKey,
        projectId: args.projectId,
        fileAreaId: args.fileAreaId,
        fileId: args.fileId,
      });
      const modelUrl = new URL(`/models/${token}`, hosting.publicUrl).toString();
      return {
        content: [{ type: 'text' as const, text: `Rendering ${fileName} in the 3D viewer.` }],
        structuredContent: { available: true, modelUrl, fileName },
      };
    },
  );
}
