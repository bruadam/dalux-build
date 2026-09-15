/**
 * The MCP App that runs inside the `ui://dalux-build/ifc-viewer` iframe (see
 * ../src/ui/ifcViewer.ts). Bundled to a single inline `<script>` by
 * `scripts/build-ifc-viewer.mjs` — this file is browser code, not part of
 * the Node build (tsup only builds src/cli.ts and src/server.ts). It lives
 * outside src/ so the Node-side `tsc --noEmit` (which has no DOM lib) never
 * has to typecheck it.
 *
 * Two independent postMessage channels are in play:
 *  - this iframe <-> the host (Claude.ai), over the MCP Apps protocol
 *    (`@modelcontextprotocol/ext-apps`'s `App` + `PostMessageTransport`).
 *  - this iframe <-> a *nested* iframe pointed at embed.ifclite.com, over
 *    ifclite's own protocol (`@ifc-lite/embed-sdk`).
 */
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { IFCLiteEmbed } from '@ifc-lite/embed-sdk';

/** Mirrors the `outputSchema` of the `view_model_3d` tool in ../src/ui/ifcViewer.ts. */
interface ViewModel3dResult {
  available: boolean;
  modelUrl?: string;
  fileName?: string;
  message?: string;
}

function isViewModel3dResult(value: unknown): value is ViewModel3dResult {
  return typeof value === 'object' && value !== null && typeof (value as { available?: unknown }).available === 'boolean';
}

function showMessage(text: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.textContent = '';
  const message = document.createElement('div');
  message.className = 'ifc-message';
  message.textContent = text;
  root.appendChild(message);
}

async function loadViewer(app: App, result: ViewModel3dResult): Promise<void> {
  if (!result.available || !result.modelUrl) {
    showMessage(result.message ?? 'No IFC model to display.');
    return;
  }

  const root = document.getElementById('root');
  if (!root) return;
  root.textContent = '';
  const container = document.createElement('div');
  container.id = 'viewer';
  root.appendChild(container);

  const theme = app.getHostContext()?.theme === 'dark' ? 'dark' : 'light';

  let viewer: IFCLiteEmbed;
  try {
    viewer = await IFCLiteEmbed.create({ container: '#viewer', modelUrl: result.modelUrl, theme });
  } catch (err) {
    showMessage(`Failed to load ${result.fileName ?? 'the model'}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  viewer.on('model-error', ({ error }) => {
    showMessage(`Failed to load ${result.fileName ?? 'the model'}: ${error.message}`);
  });

  // Surface the selected element's properties back to the model — this is
  // what makes the viewer more than a picture: Claude can reason about
  // whatever the user clicks on.
  viewer.on('entity-selected', ({ id, ifcType, globalId }) => {
    void (async () => {
      try {
        const props = await viewer.getProperties(id);
        await app.updateModelContext({
          content: [
            {
              type: 'text',
              text: `Selected IFC element ${ifcType ?? ''} ${globalId ?? id}:\n${JSON.stringify(props, null, 2)}`,
            },
          ],
        });
      } catch {
        // Best-effort — a selection that can't be described to the model
        // shouldn't break the viewer.
      }
    })();
  });
}

async function main(): Promise<void> {
  const app = new App({ name: 'dalux-ifc-viewer', version: '1.0.0' }, {}, { autoResize: true });

  // Handlers must be registered before connect() resolves — the host can
  // fire the tool-result notification immediately after the handshake.
  app.addEventListener('toolresult', (result) => {
    void loadViewer(app, isViewModel3dResult(result.structuredContent) ? result.structuredContent : { available: false });
  });
  app.addEventListener('hostcontextchanged', (ctx) => {
    document.documentElement.dataset.theme = ctx.theme ?? 'light';
  });

  showMessage('Loading model…');
  await app.connect(new PostMessageTransport(window.parent, window.parent));
}

main().catch((err) => {
  showMessage(`Failed to initialize viewer: ${err instanceof Error ? err.message : String(err)}`);
});
