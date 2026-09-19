import type { LoadedModel } from '@ifc-lite/mcp';

import { propertyDeltas } from '../src/ifc/diffEngine';

interface FakeEntity {
  globalId: string;
  type: string;
  name: string;
  expressId: number;
  psets: Record<string, Record<string, string | number | boolean | null>>;
}

/** Enough of a LoadedModel for propertyDeltas: an entity list and per-entity psets. */
function fakeModel(id: string, entities: FakeEntity[]): LoadedModel {
  const byExpressId = new Map(entities.map((e) => [e.expressId, e]));
  return {
    id,
    bim: {
      query: () => ({
        toArray: () => entities.map((e) => ({ globalId: e.globalId, type: e.type, name: e.name, ref: { modelId: id, expressId: e.expressId } })),
      }),
      properties: ({ expressId }: { expressId: number }) =>
        Object.entries(byExpressId.get(expressId)?.psets ?? {}).map(([name, props]) => ({
          name,
          properties: Object.entries(props).map(([n, value]) => ({ name: n, type: 0, value })),
        })),
    },
  } as unknown as LoadedModel;
}

const wall = (psets: FakeEntity['psets']): FakeEntity => ({
  globalId: 'g-wall',
  type: 'IfcWall',
  name: 'Wall A',
  expressId: 1,
  psets,
});

describe('propertyDeltas', () => {
  it('classifies added, removed and changed properties', () => {
    const base = fakeModel('base', [wall({ Pset_WallCommon: { FireRating: 'REI 60', IsExternal: true } })]);
    const head = fakeModel('head', [wall({ Pset_WallCommon: { FireRating: 'REI 120' }, AI_Review: { Status: 'Checked' } })]);

    const { deltas, changedElements } = propertyDeltas(base, head, { limit: 10 });
    expect(changedElements).toBe(1);
    expect(deltas[0].changes).toEqual(
      expect.arrayContaining([
        { path: 'Pset_WallCommon.FireRating', change: 'changed', base: 'REI 60', head: 'REI 120' },
        { path: 'AI_Review.Status', change: 'added', head: 'Checked' },
        { path: 'Pset_WallCommon.IsExternal', change: 'removed', base: true },
      ]),
    );
  });

  it('reports nothing for an element whose properties are identical', () => {
    const psets = { Pset_WallCommon: { FireRating: 'REI 60' } };
    const result = propertyDeltas(fakeModel('base', [wall(psets)]), fakeModel('head', [wall(psets)]), { limit: 10 });
    expect(result.changedElements).toBe(0);
    expect(result.deltas).toEqual([]);
    expect(result.comparedElements).toBe(1);
  });

  it('skips entities that exist on only one side', () => {
    // Those are `model_diff`'s added/removed; attributing property changes to
    // them would invent a pairing the diff engine never made.
    const base = fakeModel('base', [wall({ P: { X: 1 } })]);
    const head = fakeModel('head', [
      wall({ P: { X: 1 } }),
      { globalId: 'g-new', type: 'IfcWall', name: 'Wall B', expressId: 2, psets: { P: { X: 9 } } },
    ]);
    const result = propertyDeltas(base, head, { limit: 10 });
    expect(result.comparedElements).toBe(1);
    expect(result.changedElements).toBe(0);
  });

  it('honours the type filter', () => {
    const entities = (value: number): FakeEntity[] => [
      { globalId: 'g1', type: 'IfcWall', name: 'W', expressId: 1, psets: { P: { X: value } } },
      { globalId: 'g2', type: 'IfcSlab', name: 'S', expressId: 2, psets: { P: { X: value } } },
    ];
    const result = propertyDeltas(fakeModel('base', entities(1)), fakeModel('head', entities(2)), { limit: 10, type: 'IfcSlab' });
    expect(result.comparedElements).toBe(1);
    expect(result.deltas.map((d) => d.globalId)).toEqual(['g2']);
  });

  it('keeps changedElements whole when the listing is truncated', () => {
    // Truncation must never be what makes a revision look clean.
    const entities = (value: number): FakeEntity[] =>
      Array.from({ length: 5 }, (_, i) => ({
        globalId: `g${i}`,
        type: 'IfcWall',
        name: `W${i}`,
        expressId: i + 1,
        psets: { P: { X: value } },
      }));
    const result = propertyDeltas(fakeModel('base', entities(1)), fakeModel('head', entities(2)), { limit: 2 });
    expect(result.changedElements).toBe(5);
    expect(result.deltas).toHaveLength(2);
  });
});
