import { packChunks, unpackChunk, type PackableMesh } from '../src/ifc/meshPack';
import { describeSelection, getSelection, saveSelection } from '../src/ifc/viewerData';
import { chipLabel, elementStyle, type ViewState } from '../src/ifc/viewerVisibility';

function mesh(expressId: number, ifcType: string, triangles: number): PackableMesh {
  const positions = new Float32Array(9 * triangles).map((_, i) => expressId + i);
  const indices = new Uint32Array(3 * triangles).map((_, i) => i);
  return { expressId, ifcType, positions, indices, color: [1, 0.5, 0, 1] };
}

describe('meshPack', () => {
  it('round-trips meshes, splitting chunks by size and rebasing indices per chunk', () => {
    const meshes = [mesh(1, 'IfcWall', 2), mesh(2, 'IfcBeam', 1), mesh(3, 'IfcWall', 3)];
    const packed = packChunks(meshes, 100);
    expect(packed.types).toEqual(['IfcBeam', 'IfcWall']);
    expect(packed.chunks.length).toBeGreaterThan(1);

    const all = packed.chunks.map(unpackChunk);
    expect(all.flatMap((c) => [...c.expressIds])).toEqual([1, 2, 3]);
    for (const c of all) {
      expect(Math.max(...c.indices)).toBe(c.positions.length / 3 - 1);
      expect([...c.colors.slice(0, 4)]).toEqual([255, 128, 0, 255]);
    }
    const one = unpackChunk(packChunks(meshes, 1e9).chunks[0]);
    expect([...one.typeIndices]).toEqual([1, 0, 1]);
    expect([...one.vertexCounts]).toEqual([6, 3, 9]);
    expect(one.indices[6]).toBe(6); // second mesh's first index, rebased past the first mesh's 6 vertices
    expect(one.positions[18]).toBe(2);
  });

  it('adds each mesh origin to its positions', () => {
    const m = { ...mesh(1, 'IfcWall', 1), origin: [10, 20, 30] };
    const c = unpackChunk(packChunks([m], 1e9).chunks[0]);
    expect([...c.positions.slice(0, 3)]).toEqual([11, 22, 33]);
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
