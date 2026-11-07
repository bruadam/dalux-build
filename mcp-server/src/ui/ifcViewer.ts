import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { buildToolContext } from '../ifc/runtime';
import { resolveModel, type IfcRef } from '../ifc/session';
import {
  describeSelection,
  elementDetails,
  getSelection,
  resolveSelectionSpec,
  saveSelection,
  viewerGeometry,
} from '../ifc/viewerData';
import { IFC_VIEWER_BUNDLE_JS } from './ifcViewerBundle.generated';

/**
 * Interactive 3D viewer for IFC models, delivered as an MCP App (SEP-1865 /
 * `ui://` resource). The model calls `view_model_3d`; the host renders this
 * resource's HTML in a sandboxed iframe; the app (browser/ifcViewerApp.ts)
 * then pulls everything it needs through host-proxied calls to the app-only
 * `ifc_viewer_*` tools below — tessellated geometry, element properties,
 * named selections. Nothing is fetched over the network from inside the
 * iframe, so it works over stdio and HTTP alike and needs no CSP domains.
 *
 * Registers directly via `server.registerResource`/`registerTool` rather than
 * through `@modelcontextprotocol/ext-apps/server`'s wrappers: that package is
 * ESM-only, which ts-jest can't load without a Babel transform just for two
 * constants and the `_meta` shape this file writes by hand.
 */

export const RESOURCE_URI = 'ui://dalux-build/ifc-viewer';

/** MCP Apps (SEP-1865) resource MIME type. */
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
/** Pre-2.0 hosts read the UI resource URI from this flat `_meta` key instead of `_meta.ui.resourceUri`; set both for compatibility. */
const LEGACY_RESOURCE_URI_META_KEY = 'ui/resourceUri';
/** Tools only the viewer app calls; hosts keep them out of the model's tool list. */
const APP_ONLY_META = { ui: { resourceUri: RESOURCE_URI, visibility: ['app'] } };

const IFC_VIEWER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
</head>
<body>
<div id="root"></div>
<script>${IFC_VIEWER_BUNDLE_JS}</script>
</body>
</html>`;

const ifcRef = {
  projectId: z.string(),
  fileAreaId: z.string(),
  fileId: z.string().describe('The file ID (must be an .ifc file).'),
};
/** `ifcRef` without descriptions, for schemas only the app or the host reads. */
const bareRef = { projectId: z.string(), fileAreaId: z.string(), fileId: z.string() };

const elementFilter = z.object({
  type: z.string().optional(),
  property: z
    .object({
      path: z.string(),
      op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'exists', 'matches']),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })
    .optional(),
});

export const viewModel3dInput = z.object({
  ...ifcRef,
  selectionId: z
    .string()
    .optional()
    .describe('selectionId from ifc_query_elements. Preferred over filter/globalIds.'),
  filter: elementFilter
    .optional()
    .describe('Same type/property filter as ifc_query_elements.'),
  globalIds: z.array(z.string()).max(200).optional().describe('Elements by GlobalId.'),
  mode: z
    .enum(['isolate', 'xray', 'highlight'])
    .optional()
    .describe('isolate hides the rest, xray (default) ghosts it, highlight colours the selection.'),
});
export type ViewModel3dInput = z.infer<typeof viewModel3dInput>;

const viewModel3dOutput = z.object({
  available: z.boolean(),
  fileName: z.string().optional(),
  model: z.object(bareRef).optional(),
  selection: z
    .object({ selectionId: z.string(), label: z.string(), count: z.number(), mode: z.enum(['isolate', 'xray', 'highlight']) })
    .optional(),
  message: z.string().optional(),
});

async function openModel(client: DaluxClient, ref: IfcRef) {
  const resolved = await resolveModel(client, ref);
  const ctx = await buildToolContext(resolved.registry, new AbortController().signal);
  return { ...resolved, ctx };
}

function pickRef(args: IfcRef): IfcRef {
  return { projectId: args.projectId, fileAreaId: args.fileAreaId, fileId: args.fileId };
}

/** Registers `view_model_3d`, its `ui://` resource, and the app-only `ifc_viewer_*` tools on `server`. */
export function registerIfcViewer(server: McpServer, client: DaluxClient): void {
  server.registerResource(
    'ifc-viewer',
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: '3D viewer for IFC models: orbit, click for properties, filter/isolate, x-ray, section.',
      _meta: { ui: { prefersBorder: true } },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: IFC_VIEWER_HTML, _meta: { ui: { prefersBorder: true } } }],
    }),
  );

  server.registerTool(
    'view_model_3d',
    {
      title: 'View 3D Model',
      description:
        'Show an IFC model in an interactive 3D viewer inline in the chat. ' +
        'To show query results, pass a selectionId from ifc_query_elements (or filter/globalIds) and a mode. ' +
        'Elements the user clicks are shared back as context.',
      inputSchema: viewModel3dInput,
      outputSchema: viewModel3dOutput,
      _meta: { ui: { resourceUri: RESOURCE_URI }, [LEGACY_RESOURCE_URI_META_KEY]: RESOURCE_URI },
    },
    async (args) => {
      const ref = pickRef(args);
      const fail = (message: string) => ({
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { available: false, message },
        isError: true,
      });

      const fileInfo = await client.files.getFile(ref.projectId, ref.fileAreaId, ref.fileId);
      if (typeof fileInfo === 'string' || !fileInfo) return fail(`File not found: ${ref.fileId}`);
      const data = ((fileInfo as { data?: Record<string, unknown> }).data ?? fileInfo) as Record<string, unknown>;
      const fileName = (data.fileName as string | undefined) ?? ref.fileId;
      if (!fileName.toLowerCase().endsWith('.ifc')) return fail(`${fileName} is not an .ifc file.`);

      const { model, ctx } = await openModel(client, ref);
      // Start meshing now so the app's first geometry call finds it warm.
      viewerGeometry(model).catch(() => undefined);

      let selection: { selectionId: string; label: string; count: number; mode: 'isolate' | 'xray' | 'highlight' } | undefined;
      const mode = args.mode ?? 'xray';
      if (args.selectionId) {
        const saved = getSelection(args.selectionId, ref.fileId);
        if (!saved) return fail(`Unknown or expired selectionId for this file: ${args.selectionId}. Re-run ifc_query_elements.`);
        selection = { selectionId: args.selectionId, label: saved.label, count: saved.expressIds.length, mode };
      } else if (args.filter || args.globalIds?.length) {
        const spec = { filter: args.filter, globalIds: args.globalIds };
        const expressIds = await resolveSelectionSpec(ctx, model, spec);
        const label = describeSelection(spec);
        selection = { selectionId: saveSelection({ fileId: ref.fileId, label, expressIds }), label, count: expressIds.length, mode };
      }

      const text = selection
        ? `Showing ${fileName} in the 3D viewer: ${selection.label} — ${selection.count} element(s), ${selection.mode}.`
        : `Showing ${fileName} in the 3D viewer.`;
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { available: true, fileName, model: ref, ...(selection ? { selection } : {}) },
      };
    },
  );

  server.registerTool(
    'ifc_viewer_geometry',
    {
      description: '3D viewer app only.',
      inputSchema: z.object({ ...bareRef, chunk: z.number().int().min(0) }),
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const { model } = await openModel(client, pickRef(args));
      const geometry = await viewerGeometry(model);
      const data = geometry.chunks[args.chunk];
      if (data === undefined) throw new Error(`chunk ${args.chunk} out of range (0..${geometry.chunks.length - 1})`);
      return {
        content: [{ type: 'text' as const, text: `Geometry chunk ${args.chunk + 1}/${geometry.chunks.length}.` }],
        structuredContent: {
          chunk: args.chunk,
          chunkCount: geometry.chunks.length,
          types: geometry.types,
          meshCount: geometry.meshCount,
          triangleCount: geometry.triangleCount,
          data,
        },
      };
    },
  );

  server.registerTool(
    'ifc_viewer_element',
    {
      description: '3D viewer app only.',
      inputSchema: z.object({ ...bareRef, expressId: z.number().int().min(1) }),
      _meta: APP_ONLY_META,
    },
    async (args) => {
      const { model, ctx } = await openModel(client, pickRef(args));
      const details = await elementDetails(ctx, model, args.expressId);
      return {
        content: [{ type: 'text' as const, text: `${details.type} ${details.name} (${details.globalId})` }],
        structuredContent: { ...details },
      };
    },
  );

  server.registerTool(
    'ifc_viewer_selection',
    {
      description: '3D viewer app only.',
      inputSchema: z.object({ ...bareRef, selectionId: z.string() }),
      _meta: APP_ONLY_META,
    },
    async (args) => {
      await openModel(client, pickRef(args)); // authorization check
      const saved = getSelection(args.selectionId, args.fileId);
      if (!saved) throw new Error(`Unknown or expired selectionId: ${args.selectionId}`);
      return {
        content: [{ type: 'text' as const, text: `${saved.label}: ${saved.expressIds.length} element(s).` }],
        structuredContent: { label: saved.label, expressIds: saved.expressIds },
      };
    },
  );
}
