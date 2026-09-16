/**
 * Per-model catalogue of which property sets and properties actually exist.
 *
 * ifc-lite ships no tool that enumerates psets, and its lookups fail silently:
 * `properties_unique` on an unknown pset reports "(missing) — N" and
 * `export_csv` with an unknown column emits a header-only file. Both read as
 * "no data" rather than "wrong name". Every pset/property path a caller
 * supplies is therefore validated against this catalogue first.
 *
 * Coverage counts matter too: pset naming is exporter-specific (Tekla emits
 * "Tekla Quantity" / "ColumnBaseQuantities", i-Theses emits
 * "i-Theses TSB_PlateBase"), and on some models most products carry no psets
 * at all — so "can this model answer the question" is itself a real answer.
 */
import type { LoadedModel } from '@ifc-lite/mcp';
import type { PropertySetData } from '@ifc-lite/sdk';

export type PropertyValue = string | number | boolean | null;

export interface PropertyFacts {
  name: string;
  /** How many elements of this type carry the property. */
  count: number;
  sample: PropertyValue;
  valueType: 'number' | 'string' | 'boolean' | 'other';
}

export interface PsetFacts {
  name: string;
  properties: PropertyFacts[];
}

export interface TypeFacts {
  type: string;
  elementCount: number;
  /** Elements of this type carrying at least one property set. */
  withProperties: number;
  psets: PsetFacts[];
}

export interface Catalogue {
  types: TypeFacts[];
  totalProducts: number;
  productsWithProperties: number;
}

const cache = new WeakMap<LoadedModel, Catalogue>();

function classify(v: unknown): PropertyFacts['valueType'] {
  const t = typeof v;
  return t === 'number' || t === 'string' || t === 'boolean' ? t : 'other';
}

export function buildCatalogue(model: LoadedModel): Catalogue {
  const cached = cache.get(model);
  if (cached) return cached;

  const byType = new Map<string, {
    elementCount: number;
    withProperties: number;
    psets: Map<string, Map<string, PropertyFacts>>;
  }>();

  let totalProducts = 0;
  let productsWithProperties = 0;

  for (const element of model.bim.query().toArray()) {
    totalProducts++;
    const type = element.type || 'unknown';
    let bucket = byType.get(type);
    if (!bucket) byType.set(type, (bucket = { elementCount: 0, withProperties: 0, psets: new Map() }));
    bucket.elementCount++;

    let psets: PropertySetData[] = [];
    try {
      psets = model.bim.properties(element.ref) ?? [];
    } catch {
      continue;
    }
    if (psets.length === 0) continue;
    bucket.withProperties++;
    productsWithProperties++;

    for (const pset of psets) {
      const psetName = pset.name;
      let props = bucket.psets.get(psetName);
      if (!props) bucket.psets.set(psetName, (props = new Map()));
      for (const prop of pset.properties ?? []) {
        const propName = prop.name;
        const existing = props.get(propName);
        if (existing) {
          existing.count++;
          if (existing.sample == null) existing.sample = prop.value;
        } else {
          props.set(propName, {
            name: propName,
            count: 1,
            sample: prop.value,
            valueType: classify(prop.value),
          });
        }
      }
    }
  }

  const catalogue: Catalogue = {
    totalProducts,
    productsWithProperties,
    types: [...byType.entries()]
      .map(([type, b]) => ({
        type,
        elementCount: b.elementCount,
        withProperties: b.withProperties,
        psets: [...b.psets.entries()].map(([name, props]) => ({
          name,
          properties: [...props.values()].sort((a, z) => z.count - a.count),
        })),
      }))
      .sort((a, z) => z.elementCount - a.elementCount),
  };

  cache.set(model, catalogue);
  return catalogue;
}

/** Plain element attributes `export_csv` accepts alongside `Pset.Property` paths. */
const ATTRIBUTE_COLUMNS = new Set(['globalid', 'name', 'type', 'description', 'tag', 'objecttype']);

export function splitPath(path: string): { pset: string; property: string } | null {
  // Pset names routinely contain spaces and hyphens ("Tekla Quantity",
  // "i-Theses TSB_PlateBase") but not dots, so the last dot is the separator.
  const idx = path.lastIndexOf('.');
  if (idx <= 0 || idx === path.length - 1) return null;
  return { pset: path.slice(0, idx), property: path.slice(idx + 1) };
}

export function isKnownProperty(cat: Catalogue, type: string | undefined, pset: string, property: string): boolean {
  const types = type ? cat.types.filter((t) => t.type === type) : cat.types;
  return types.some((t) =>
    t.psets.some((p) => p.name === pset && p.properties.some((pr) => pr.name === property)),
  );
}

/**
 * Reject unknown columns before handing them to ifc-lite, which would return
 * blanks instead. Returns a message naming the bad paths and the nearest real
 * alternatives, or null when everything resolves.
 */
export function validateColumns(cat: Catalogue, type: string | undefined, columns: string[]): string | null {
  const unknown: string[] = [];
  for (const column of columns) {
    if (ATTRIBUTE_COLUMNS.has(column.toLowerCase())) continue;
    const parts = splitPath(column);
    if (!parts || !isKnownProperty(cat, type, parts.pset, parts.property)) unknown.push(column);
  }
  if (unknown.length === 0) return null;

  const scoped = type ? cat.types.filter((t) => t.type === type) : cat.types;
  const available = scoped
    .flatMap((t) => t.psets.flatMap((p) => p.properties.map((pr) => `${p.name}.${pr.name}`)))
    .slice(0, 40);
  return (
    `Unknown column(s) for ${type ?? 'this model'}: ${unknown.join(', ')}. ` +
    `ifc-lite returns blanks rather than an error for these, so the request was rejected. ` +
    `Available: ${available.join(', ') || '(this type carries no property sets)'}`
  );
}
