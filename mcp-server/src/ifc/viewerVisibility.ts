/**
 * Pure display logic for the 3D viewer app (browser/ifcViewerApp.ts): which
 * elements are drawn solid, ghosted, or hidden, and which get a highlight
 * colour. Kept free of DOM/three.js so it is unit-tested under Node.
 */

export type SelectionMode = 'isolate' | 'xray' | 'highlight';
export type ElementLook = 'solid' | 'ghost' | 'hidden';
export type ElementTint = 'none' | 'selected' | 'picked';

export interface ViewState {
  /** Elements named by the chat (view_model_3d selection); undefined = no filter. */
  selection?: ReadonlySet<number>;
  mode: SelectionMode;
  /** IFC classes the user switched off in the viewer. */
  hiddenTypes: ReadonlySet<string>;
  /** X-ray toggle: ghost everything that is not selected/picked. */
  xray: boolean;
  /** Element whose properties are open in the side panel. */
  picked?: number;
}

export interface ElementStyle {
  look: ElementLook;
  tint: ElementTint;
}

export function elementStyle(expressId: number, type: string, state: ViewState): ElementStyle {
  const picked = state.picked === expressId;
  if (state.hiddenTypes.has(type) && !picked) return { look: 'hidden', tint: 'none' };
  const inSelection = state.selection?.has(expressId) ?? false;
  const tint: ElementTint = picked ? 'picked' : inSelection && state.mode !== 'isolate' ? 'selected' : 'none';
  if (picked) return { look: 'solid', tint };
  if (state.selection && !inSelection) {
    if (state.mode === 'isolate') return { look: 'hidden', tint };
    if (state.mode === 'xray') return { look: 'ghost', tint };
  }
  if (state.xray && !inSelection) return { look: 'ghost', tint };
  return { look: 'solid', tint };
}

/** Text for the filter chip, e.g. "IfcColumn · 120 of 315". */
export function chipLabel(label: string, matched: number, total: number): string {
  return `${label} · ${matched} of ${total}`;
}
