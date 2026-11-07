import { gunzipSync, gzipSync } from 'node:zlib';
import { MAX_PIECE_BYTES, packEncodedChunks, splitMesh, unpackChunk, type PackableMesh } from '../src/ifc/meshPack';
import { APP_RESULT_MAX_CHARS, describeSelection, fitElementDetails, getSelection, saveSelection, SELECTION_PAGE_SIZE } from '../src/ifc/viewerData';
import { chipLabel, elementStyle, type ViewState } from '../src/ifc/viewerVisibility';

function mesh(expressId: number, ifcType: string, triangles: number): PackableMesh {
  const positions = new Float32Array(9 * triangles).map((_, i) => expressId + i);
  const indices = new Uint32Array(3 * triangles).map((_, i) => i);
  return { expressId, ifcType, positions, indices, color: [1, 0.5, 0, 1] };
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const gzipBase64 = (bytes: Uint8Array) => gzipSync(bytes).toString('base64');

/** Pseudo-random positions: compresses about as badly as real coordinates. */
function noisyMesh(expressId: number, triangles: number): PackableMesh {
  let seed = expressId;
  const positions = new Float32Array(9 * triangles).map(() => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 100);
  const indices = new Uint32Array(3 * triangles).map((_, i) => i);
  return { expressId, ifcType: 'IfcWall', positions, indices, color: [1, 1, 1, 1] };
}

describe('meshPack', () => {
  it('round-trips meshes, splitting chunks by encoded size and rebasing indices per chunk', () => {
    const meshes = [mesh(1, 'IfcWall', 2), mesh(2, 'IfcBeam', 1), mesh(3, 'IfcWall', 3)];
    const packed = packEncodedChunks(meshes, 300, toBase64);
    expect(packed.types).toEqual(['IfcBeam', 'IfcWall']);
    expect(packed.chunks.length).toBeGreaterThan(1);
    for (const chunk of packed.chunks) expect(chunk.length).toBeLessThanOrEqual(300);

    const all = packed.chunks.map((c) => unpackChunk(fromBase64(c)));
    expect(all.flatMap((c) => [...c.expressIds])).toEqual([1, 2, 3]);
    for (const c of all) {
      expect(Math.max(...c.indices)).toBe(c.positions.length / 3 - 1);
      expect([...c.colors.slice(0, 4)]).toEqual([255, 128, 0, 255]);
    }
    const one = unpackChunk(fromBase64(packEncodedChunks(meshes, 1e9, toBase64).chunks[0]));
    expect([...one.typeIndices]).toEqual([1, 0, 1]);
    expect([...one.vertexCounts]).toEqual([6, 3, 9]);
    expect(one.indices[6]).toBe(6); // second mesh's first index, rebased past the first mesh's 6 vertices
    expect(one.positions[18]).toBe(2);
  });

  it('adds each mesh origin to its positions', () => {
    const m = { ...mesh(1, 'IfcWall', 1), origin: [10, 20, 30] };
    const c = unpackChunk(fromBase64(packEncodedChunks([m], 1e9, toBase64).chunks[0]));
    expect([...c.positions.slice(0, 3)]).toEqual([11, 22, 33]);
  });

  it('splits a big mesh into pieces that keep every triangle', () => {
    const big = noisyMesh(7, 20_000);
    const pieces = splitMesh(big);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.reduce((n, p) => n + p.indices.length, 0)).toBe(big.indices.length);
    for (const p of pieces) expect(20 + p.positions.byteLength + p.indices.byteLength).toBeLessThanOrEqual(MAX_PIECE_BYTES);
    const last = pieces[pieces.length - 1];
    const tri = big.indices.length / 3 - 1;
    expect([...last.positions.slice(3 * last.indices[last.indices.length - 1], 3 * last.indices[last.indices.length - 1] + 3)])
      .toEqual([...big.positions.slice(3 * (3 * tri + 2), 3 * (3 * tri + 2) + 3)]);
  });

  it('keeps every gzip+base64 geometry chunk of a large model under the app result cap', () => {
    // ~1.2M triangles' worth of raw data spread over many meshes, plus one huge mesh.
    const meshes = [noisyMesh(1, 200_000), ...Array.from({ length: 400 }, (_, i) => noisyMesh(i + 2, 500))];
    const packed = packEncodedChunks(meshes, 90_000, gzipBase64);
    const longest = Math.max(...packed.chunks.map((c) => c.length));
    expect(longest).toBeLessThanOrEqual(90_000);
    expect(longest).toBeGreaterThan(60_000); // chunks are filled, not split needlessly small
    const triangles = packed.chunks.reduce((n, c) => n + unpackChunk(new Uint8Array(gunzipSync(Buffer.from(c, 'base64')))).indices.length / 3, 0);
    expect(triangles).toBe(400_000);
  });
});

describe('fitElementDetails', () => {
  it('returns small details unchanged', () => {
    const d = { expressId: 1, type: 'IfcWall', name: 'W', globalId: 'g', sets: [{ name: 'P', kind: 'pset' as const, values: { a: 1 } }] };
    expect(fitElementDetails(d)).toBe(d);
  });

  it('cuts long values and drops trailing sets until the details fit', () => {
    const values = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, 'x'.repeat(5_000)]));
    const sets = Array.from({ length: 10 }, (_, i) => ({ name: `Set${i}`, kind: 'pset' as const, values }));
    const fitted = fitElementDetails({ expressId: 1, type: 'IfcWall', name: 'W', globalId: 'g', sets });
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(APP_RESULT_MAX_CHARS);
    expect(fitted.truncated).toBe(true);
    expect(fitted.sets[0].name).toBe('Set0');
  });
});

describe('selections', () => {
  it('stores a selection under an opaque id readable only for the same file', () => {
    const id = saveSelection({ fileId: 'f1', label: 'IfcColumn', expressIds: [5, 6] });
    expect(id).toMatch(/^sel_/);
    expect(getSelection(id, 'f1')).toEqual({ fileId: 'f1', label: 'IfcColumn', expressIds: [5, 6] });
    expect(getSelection(id, 'other')).toBeUndefined();
    expect(getSelection('sel_unknown', 'f1')).toBeUndefined();
  });

  it('fits a full page of the largest express ids in one app result', () => {
    const page = { label: 'x'.repeat(500), total: 1e6, offset: 1e6, expressIds: Array(SELECTION_PAGE_SIZE).fill(2 ** 31 - 1) };
    expect(JSON.stringify({ content: [{ type: 'text', text: page.label }], structuredContent: page }).length).toBeLessThanOrEqual(APP_RESULT_MAX_CHARS);
  });

  it('describes a selection for the filter chip', () => {
    expect(describeSelection({ filter: { type: 'IfcColumn', property: { path: 'Tekla Quantity.Weight', op: '>', value: 500 } } }))
      .toBe('IfcColumn · Tekla Quantity.Weight > 500');
    expect(describeSelection({ globalIds: ['a'] })).toBe('1 GlobalId');
    expect(describeSelection({})).toBe('All elements');
  });
});

describe('elementStyle', () => {
  const base: ViewState = { mode: 'xray', hiddenTypes: new Set(), xray: false };
  const sel = new Set([1]);

  it('shows everything solid without a selection', () => {
    expect(elementStyle(2, 'IfcWall', base)).toEqual({ look: 'solid', tint: 'none' });
  });

  it.each([
    ['isolate', { look: 'solid', tint: 'none' }, { look: 'hidden', tint: 'none' }],
    ['xray', { look: 'solid', tint: 'selected' }, { look: 'ghost', tint: 'none' }],
    ['highlight', { look: 'solid', tint: 'selected' }, { look: 'solid', tint: 'none' }],
  ] as const)('%s mode styles members and the rest', (mode, member, rest) => {
    const state = { ...base, mode, selection: sel };
    expect(elementStyle(1, 'IfcWall', state)).toEqual(member);
    expect(elementStyle(2, 'IfcWall', state)).toEqual(rest);
  });

  it('hides switched-off classes, ghosts non-members under x-ray, and always shows the picked element', () => {
    const state: ViewState = { ...base, hiddenTypes: new Set(['IfcSlab']), xray: true, picked: 3 };
    expect(elementStyle(2, 'IfcSlab', state).look).toBe('hidden');
    expect(elementStyle(2, 'IfcWall', state).look).toBe('ghost');
    expect(elementStyle(3, 'IfcSlab', state)).toEqual({ look: 'solid', tint: 'picked' });
  });

  it('labels the chip', () => {
    expect(chipLabel('IfcColumn', 120, 315)).toBe('IfcColumn · 120 of 315');
  });
});
