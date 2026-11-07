/**
 * The MCP App that runs inside the `ui://dalux-build/ifc-viewer` iframe (see
 * ../src/ui/ifcViewer.ts). Bundled to a single inline `<script>` by
 * `scripts/build-ifc-viewer.mjs`; it lives outside src/ so the Node-side
 * `tsc --noEmit` (no DOM lib) never typechecks it.
 *
 * Everything comes through the host bridge (`app.callServerTool`) — geometry
 * chunks, element properties, selection members — so the iframe makes no
 * network requests and renders with plain WebGL (three.js).
 */
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { gunzipSync } from 'fflate';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { unpackChunk } from '../src/ifc/meshPack';
import { chipLabel, elementStyle, type SelectionMode, type ViewState } from '../src/ifc/viewerVisibility';

interface ModelRef { projectId: string; fileAreaId: string; fileId: string }
interface ViewResult {
  available: boolean;
  fileName?: string;
  model?: ModelRef;
  selection?: { selectionId: string; label: string; count: number; mode: SelectionMode };
  message?: string;
}
interface ElementDetails {
  expressId: number; type: string; name: string; globalId: string; description?: string; material?: string;
  sets: { name: string; kind: 'pset' | 'qto'; values: Record<string, string | number | boolean | null> }[];
}

/** One element's slice of a chunk: vertex range (for picking) and index range (for drawing). */
interface Element { id: number; type: string; chunk: number; v0: number; v1: number; i0: number; i1: number; rgba: [number, number, number, number] }
interface Chunk { positions: THREE.BufferAttribute; colors: THREE.BufferAttribute; indices: Uint32Array; solid: THREE.Mesh; ghost: THREE.Mesh; elements: Element[] }

const SELECTED_RGB = [255, 140, 0];
const PICKED_RGB = [0, 170, 255];

const CSS = `
:root{--bg:#f4f5f7;--fg:#1d2330;--muted:#6b7280;--panel:#fff;--line:#d9dce3;--accent:#0a84ff}
.dark{--bg:#1c1f26;--fg:#e8eaf0;--muted:#9aa1ad;--panel:#262a33;--line:#3a3f4b}
[hidden]{display:none!important}
html,body{margin:0;height:100%;font:13px system-ui,sans-serif;color:var(--fg);background:var(--bg)}
#app{position:relative;height:560px;display:flex;overflow:hidden}
.full #app{height:100vh}
#stage{position:relative;flex:1;min-width:0}
#stage canvas{display:block;width:100%;height:100%;outline:none}
#bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;pointer-events:none}
#bar>*{pointer-events:auto}
button,select{font:inherit;color:var(--fg);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px 8px;cursor:pointer}
button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.chip{display:flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border-radius:14px;padding:3px 4px 3px 10px}
.chip button{background:#fff2;color:#fff;border:0;border-radius:10px;padding:2px 8px}
#section{display:flex;align-items:center;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:2px 6px}
#status{position:absolute;left:8px;bottom:8px;color:var(--muted);font-size:12px;pointer-events:none}
#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:var(--muted)}
#panel{width:320px;min-width:220px;max-width:70%;background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;position:relative}
#panel[hidden]{display:none}
#grip{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize}
#panel header{display:flex;gap:8px;align-items:flex-start;padding:10px;border-bottom:1px solid var(--line)}
#panel header div{flex:1;min-width:0}
#panel h2{font-size:14px;margin:0 0 2px;overflow-wrap:anywhere}
#panel .sub{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
#panel .body{overflow:auto;padding:4px 10px 10px;flex:1}
#panel details{border-bottom:1px solid var(--line);padding:6px 0}
#panel summary{cursor:pointer;font-weight:600}
#panel table{width:100%;border-collapse:collapse;margin-top:4px}
#panel td{padding:2px 4px;vertical-align:top;overflow-wrap:anywhere}
#panel td:first-child{color:var(--muted);width:45%}
#panel .actions{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--line)}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function callTool<T>(app: App, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await app.callServerTool({ name, arguments: args });
  if (res.isError) throw new Error(res.content?.map((c) => ('text' in c ? c.text : '')).join(' ') || `${name} failed`);
  return res.structuredContent as T;
}

class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
  readonly controls: OrbitControls;
  readonly clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  readonly solidMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: [this.clip] });
  readonly ghostMat = new THREE.MeshBasicMaterial({ color: 0x8892a6, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [this.clip] });
  readonly chunks: Chunk[] = [];
  readonly byId = new Map<number, Element>();
  bounds = new THREE.Box3();
  private frame = 0;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D model view. Drag to orbit, scroll to zoom, right-drag to pan, click an element for its properties.');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  setTheme(dark: boolean): void {
    this.scene.background = new THREE.Color(dark ? 0x1c1f26 : 0xf4f5f7);
    this.render();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.controls.update()) this.render();
      this.renderer.render(this.scene, this.camera);
    });
  }

  addChunk(bytes: Uint8Array, types: string[]): void {
    const c = unpackChunk(bytes);
    const positions = new THREE.BufferAttribute(c.positions, 3);
    const colors = new THREE.BufferAttribute(new Uint8Array((c.positions.length / 3) * 3), 3, true);
    const elements: Element[] = [];
    let v = 0;
    let i = 0;
    for (let k = 0; k < c.expressIds.length; k++) {
      const rgba = [c.colors[4 * k], c.colors[4 * k + 1], c.colors[4 * k + 2], c.colors[4 * k + 3]] as Element['rgba'];
      const e: Element = { id: c.expressIds[k], type: types[c.typeIndices[k]] ?? '', chunk: this.chunks.length, v0: v, v1: v + c.vertexCounts[k], i0: i, i1: i + c.indexCounts[k], rgba };
      v = e.v1;
      i = e.i1;
      elements.push(e);
      if (!this.byId.has(e.id)) this.byId.set(e.id, e);
    }
    const make = (mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', positions);
      g.setAttribute('color', colors);
      const mesh = new THREE.Mesh(g, mat);
      this.scene.add(mesh);
      return mesh;
    };
    const chunk: Chunk = { positions, colors, indices: c.indices, solid: make(this.solidMat), ghost: make(this.ghostMat), elements };
    chunk.ghost.renderOrder = 1;
    this.chunks.push(chunk);
    chunk.solid.geometry.computeBoundingBox();
    this.bounds.union(chunk.solid.geometry.boundingBox!);
  }

  /** Rebuilds each chunk's solid/ghost index buffers and tints from `state`. */
  apply(state: ViewState): void {
    for (const chunk of this.chunks) {
      const solid: number[] = [];
      const ghost: number[] = [];
      const col = chunk.colors.array as Uint8Array;
      for (const e of chunk.elements) {
        const { look, tint } = elementStyle(e.id, e.type, state);
        const rgb = tint === 'picked' ? PICKED_RGB : tint === 'selected' ? SELECTED_RGB : e.rgba;
        for (let v = e.v0; v < e.v1; v++) col.set([rgb[0], rgb[1], rgb[2]], 3 * v);
        if (look === 'hidden') continue;
        const target = look === 'solid' ? solid : ghost;
        for (let i = e.i0; i < e.i1; i++) target.push(chunk.indices[i]);
      }
      chunk.colors.needsUpdate = true;
      chunk.solid.geometry.setIndex(solid);
      chunk.ghost.geometry.setIndex(ghost);
    }
    this.render();
  }

  /** Box of the given elements (all elements when undefined). */
  boxOf(ids?: Iterable<number>): THREE.Box3 {
    if (!ids) return this.bounds.clone();
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const id of ids) {
      const e = this.byId.get(id);
      if (!e) continue;
      const pos = this.chunks[e.chunk].positions;
      for (let v = e.v0; v < e.v1; v++) box.expandByPoint(p.fromBufferAttribute(pos, v));
    }
    return box.isEmpty() ? this.bounds.clone() : box;
  }

  fit(box: THREE.Box3): void {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.5);
    const dist = (0.75 * r) / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.8, 1.2);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(dir.normalize().multiplyScalar(dist));
    this.camera.near = dist / 1000;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Express id of the solid element under the pointer, if any. */
  pick(clientX: number, clientY: number): number | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.chunks.map((c) => c.solid), false).filter((h) => this.clip.distanceToPoint(h.point) >= 0);
    const hit = hits[0];
    if (!hit?.face) return undefined;
    const chunk = this.chunks.find((c) => c.solid === hit.object)!;
    const v = hit.face.a;
    let lo = 0;
    let hi = chunk.elements.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (chunk.elements[mid].v0 <= v) lo = mid;
      else hi = mid - 1;
    }
    return chunk.elements[lo]?.id;
  }

  /** Section plane: keeps everything below `t` (0..1) of the model height. */
  setSection(t: number | undefined): void {
    this.clip.constant = t === undefined ? 1e9 : this.bounds.min.y + t * (this.bounds.max.y - this.bounds.min.y);
    this.render();
  }
}

function fmt(v: string | number | boolean | null): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return v === null ? '—' : String(v);
}

async function main(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.getElementById('root')!;
  const stage = el('div', { id: 'stage' });
  const bar = el('div', { id: 'bar' });
  const status = el('div', { id: 'status', role: 'status' });
  const msg = el('div', { id: 'msg' }, 'Waiting for the model…');
  const panel = el('aside', { id: 'panel', hidden: true, tabIndex: -1 });
  panel.setAttribute('aria-label', 'Element properties');
  stage.append(bar, status, msg);
  root.append(el('div', { id: 'app' }, stage, panel));

  const app = new App({ name: 'dalux-ifc-viewer', version: '2.0.0' }, {}, { autoResize: true });
  const applyTheme = () => {
    const dark = app.getHostContext()?.theme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    viewer?.setTheme(dark);
  };
  let viewer: Viewer | undefined;
  let started = false;

  app.addEventListener('hostcontextchanged', (ctx) => {
    if (ctx.theme) applyTheme();
    if (ctx.displayMode) document.documentElement.classList.toggle('full', ctx.displayMode === 'fullscreen');
  });
  app.addEventListener('toolresult', (result) => {
    if (started) return;
    started = true;
    const data = result.structuredContent as ViewResult | undefined;
    if (!data?.available || !data.model) {
      msg.textContent = data?.message ?? 'No IFC model to display.';
      return;
    }
    load(data).catch((err) => {
      msg.hidden = false;
      msg.textContent = `Failed to load ${data.fileName ?? 'the model'}: ${err instanceof Error ? err.message : String(err)}`;
    });
  });
  await app.connect(new PostMessageTransport(window.parent, window.parent));

  async function load(data: ViewResult): Promise<void> {
    const ref = data.model!;
    try {
      viewer = new Viewer(stage);
    } catch {
      msg.textContent = 'This browser cannot create a WebGL context, so the 3D view is unavailable.';
      return;
    }
    applyTheme();
    msg.textContent = `Loading ${data.fileName ?? 'model'}…`;
    let types: string[] = [];
    let total = 1;
    let meshCount = 0;
    let triangleCount = 0;
    for (let chunk = 0; chunk < total; chunk++) {
      const g = await callTool<{ chunkCount: number; types: string[]; meshCount: number; triangleCount: number; data: string }>(app, 'ifc_viewer_geometry', { ...ref, chunk });
      ({ types, meshCount, triangleCount } = g);
      total = g.chunkCount;
      viewer.addChunk(gunzipSync(base64ToBytes(g.data)), types);
      msg.textContent = `Loading ${data.fileName ?? 'model'}… ${chunk + 1}/${total}`;
    }
    msg.hidden = true;

    const state: ViewState = { mode: data.selection?.mode ?? 'xray', hiddenTypes: new Set(), xray: false };
    let selectionLabel = '';
    if (data.selection) {
      const sel = await callTool<{ label: string; expressIds: number[] }>(app, 'ifc_viewer_selection', { ...ref, selectionId: data.selection.selectionId });
      state.selection = new Set(sel.expressIds);
      selectionLabel = sel.label;
    }
    const v = viewer;
    const elementCount = new Set(v.byId.keys()).size;
    status.textContent = `${data.fileName ?? ''} · ${meshCount} meshes · ${triangleCount.toLocaleString()} triangles`;

    // ----- toolbar -----
    const button = (label: string, title: string, onClick: () => void) => {
      const b = el('button', { type: 'button', title }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    const chip = el('div', { className: 'chip' });
    const renderChip = () => {
      chip.replaceChildren();
      chip.hidden = !state.selection;
      if (!state.selection) return;
      const modeSel = el('select', { title: 'How to show the selection' });
      for (const m of ['isolate', 'xray', 'highlight'] as const) modeSel.append(el('option', { value: m, selected: m === state.mode }, m));
      modeSel.addEventListener('change', () => { state.mode = modeSel.value as SelectionMode; refresh(); });
      chip.append(
        el('span', {}, chipLabel(selectionLabel, state.selection.size, elementCount)),
        modeSel,
        button('Show all', 'Clear the filter and show every element', () => { state.selection = undefined; refresh(); v.fit(v.boxOf()); }),
      );
    };
    const xrayBtn = button('X-ray', 'Ghost everything except the selection', () => { state.xray = !state.xray; refresh(); });
    const typeSel = el('select', { title: 'Show or hide an IFC class' });
    const renderTypes = () => {
      typeSel.replaceChildren(el('option', { value: '' }, `Classes (${types.length - state.hiddenTypes.size}/${types.length})`));
      for (const t of types) typeSel.append(el('option', { value: t }, `${state.hiddenTypes.has(t) ? '☐' : '☑'} ${t}`));
    };
    typeSel.addEventListener('change', () => {
      const t = typeSel.value;
      if (t) state.hiddenTypes.has(t) ? (state.hiddenTypes as Set<string>).delete(t) : (state.hiddenTypes as Set<string>).add(t);
      refresh();
    });
    const sectionInput = el('input', { type: 'range', min: '0', max: '100', value: '100', title: 'Section height' });
    sectionInput.setAttribute('aria-label', 'Section height');
    sectionInput.addEventListener('input', () => v.setSection(Number(sectionInput.value) >= 100 ? undefined : Number(sectionInput.value) / 100));
    const fitBtn = button('Fit', 'Fit the visible elements in view (F)', () => fitVisible());
    bar.append(fitBtn, xrayBtn, typeSel, el('label', { id: 'section' }, 'Section', sectionInput), chip);
    if (app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) {
      bar.append(button('⛶', 'Toggle fullscreen', () => {
        const full = document.documentElement.classList.contains('full');
        void app.requestDisplayMode({ mode: full ? 'inline' : 'fullscreen' });
      }));
    }

    function refresh(): void {
      xrayBtn.setAttribute('aria-pressed', String(state.xray));
      renderChip();
      renderTypes();
      v.apply(state);
    }
    function fitVisible(): void {
      v.fit(v.boxOf(state.selection && state.mode === 'isolate' ? state.selection : undefined));
    }

    // ----- picking + side panel -----
    let resolvePanel = 0;
    const closePanel = () => {
      panel.hidden = true;
      state.picked = undefined;
      refresh();
      v.renderer.domElement.focus();
    };
    async function openPanel(expressId: number): Promise<void> {
      state.picked = expressId;
      refresh();
      const token = ++resolvePanel;
      panel.hidden = false;
      panel.replaceChildren(el('div', { className: 'body' }, 'Loading properties…'));
      let d: ElementDetails;
      try {
        d = await callTool<ElementDetails>(app, 'ifc_viewer_element', { ...ref, expressId });
      } catch (err) {
        panel.replaceChildren(el('div', { className: 'body' }, `Could not load properties: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      if (token !== resolvePanel) return;
      const close = button('✕', 'Close (Esc)', closePanel);
      close.setAttribute('aria-label', 'Close properties');
      const grip = el('div', { id: 'grip', title: 'Drag to resize' });
      grip.addEventListener('pointerdown', (ev) => {
        grip.setPointerCapture(ev.pointerId);
        const startX = ev.clientX;
        const startW = panel.offsetWidth;
        const move = (e: PointerEvent) => { panel.style.width = `${startW + startX - e.clientX}px`; };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', move), { once: true });
      });
      const body = el('div', { className: 'body' });
      const attrs: [string, string][] = [['GlobalId', d.globalId], ['Express id', String(d.expressId)]];
      if (d.description) attrs.push(['Description', d.description]);
      if (d.material) attrs.push(['Material', d.material]);
      const table = (rows: [string, string][]) => el('table', {}, ...rows.map(([k, val]) => el('tr', {}, el('td', {}, k), el('td', {}, val))));
      body.append(el('details', { open: true }, el('summary', {}, 'Attributes'), table(attrs)));
      for (const s of d.sets) {
        body.append(el('details', { open: d.sets.length <= 4 }, el('summary', {}, `${s.kind === 'qto' ? 'Quantities · ' : ''}${s.name}`),
          table(Object.entries(s.values).map(([k, val]) => [k, fmt(val)]))));
      }
      const summary = `${d.type} "${d.name}" (GlobalId ${d.globalId}, express id ${d.expressId})`;
      const actions = el('div', { className: 'actions' },
        button('Zoom to', 'Fit this element in view', () => v.fit(v.boxOf([d.expressId]))),
        button('Isolate', 'Show only this element', () => { state.selection = new Set([d.expressId]); selectionLabel = d.name || d.type; state.mode = 'isolate'; refresh(); v.fit(v.boxOf([d.expressId])); }),
        button('Ask in chat', 'Send this element to the chat', () => {
          void app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Tell me about ${summary} in ${data.fileName ?? 'the model'}.` }] });
        }),
      );
      panel.replaceChildren(grip, el('header', {}, el('div', {}, el('h2', {}, d.name || '(unnamed)'), el('div', { className: 'sub' }, d.type)), close), body, actions);
      panel.focus();
      // Share the selection with the model so a follow-up question can refer to "this element".
      void app.updateModelContext({
        content: [{ type: 'text', text: `In the 3D viewer of ${data.fileName ?? 'the model'} (fileId ${ref.fileId}), the user selected ${summary}.` }],
        structuredContent: { selectedElement: { expressId: d.expressId, globalId: d.globalId, type: d.type, name: d.name }, model: ref },
      }).catch(() => undefined);
    }

    let down: { x: number; y: number } | undefined;
    const canvas = v.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const id = v.pick(e.clientX, e.clientY);
      if (id === undefined) closePanel();
      else void openPanel(id);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape' && !panel.hidden) closePanel();
      else if (e.key === 'f' || e.key === 'F') fitVisible();
      else if (e.key === 'x' || e.key === 'X') xrayBtn.click();
    });
    (window as unknown as { __viewer: unknown }).__viewer = { openPanel, state, refresh, viewer: v };

    refresh();
    fitVisible();
  }
}

void main();
