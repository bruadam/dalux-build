import type { MeshData } from '@ifc-lite/geometry';
import { collectVolumesByExpressId, summarizeByType, type ElementVolume } from '../src/ifc/volumeEngine';

function mesh(expressId: number, geometryVolume?: number): MeshData {
  return { expressId, geometryVolume } as unknown as MeshData;
}

describe('collectVolumesByExpressId', () => {
  it('takes one volume per entity even when several submeshes carry it', () => {
    // A layered/multi-material entity produces multiple MeshData rows that all
    // repeat the same whole-entity volume; summing them would multiply it.
    const meshes = [mesh(1, 2.5), mesh(1, 2.5), mesh(1, 2.5)];
    const byExpressId = collectVolumesByExpressId(meshes, new Map());
    expect(byExpressId.get(1)).toBe(2.5);
    expect(byExpressId.size).toBe(1);
  });

  it('omits entities the kernel could not prove a volume for', () => {
    const meshes = [mesh(1, 2.5), mesh(2, undefined)];
    const byExpressId = collectVolumesByExpressId(meshes, new Map());
    expect(byExpressId.get(1)).toBe(2.5);
    expect(byExpressId.has(2)).toBe(false);
  });

  it('folds in GPU-instanced-only entities, which never appear in meshes', () => {
    const meshes = [mesh(1, 2.5)];
    const instanced = new Map([[99, 0.75]]);
    const byExpressId = collectVolumesByExpressId(meshes, instanced);
    expect(byExpressId.get(1)).toBe(2.5);
    expect(byExpressId.get(99)).toBe(0.75);
  });
});

describe('summarizeByType', () => {
  const elements: ElementVolume[] = [
    { expressId: 1, globalId: 'g1', name: 'Col A', type: 'IfcColumn', volumeM3: 1.2 },
    { expressId: 2, globalId: 'g2', name: 'Col B', type: 'IfcColumn', volumeM3: 0.8 },
    // An open shell or layered wall: meshed but no proved volume.
    { expressId: 3, globalId: 'g3', name: 'Wall A', type: 'IfcWall', volumeM3: null },
  ];

  it('sums proved volumes only, never treating null as zero', () => {
    const byType = summarizeByType(elements);
    const columns = byType.find((t) => t.type === 'IfcColumn')!;
    expect(columns.elementCount).toBe(2);
    expect(columns.provedCount).toBe(2);
    expect(columns.totalVolumeM3).toBeCloseTo(2.0);

    const walls = byType.find((t) => t.type === 'IfcWall')!;
    expect(walls.elementCount).toBe(1);
    expect(walls.provedCount).toBe(0);
    expect(walls.totalVolumeM3).toBe(0);
  });

  it('orders types by descending total volume', () => {
    const byType = summarizeByType(elements);
    expect(byType.map((t) => t.type)).toEqual(['IfcColumn', 'IfcWall']);
  });
});
