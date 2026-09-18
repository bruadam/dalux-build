/**
 * Per-element geometric volumes, derived from tessellation rather than
 * declared IFC quantities.
 *
 * ifc_schedule already established that Dalux exports carry volume/weight in
 * vendor property sets, not IfcElementQuantity, and that those declared
 * values are frequently absent or exporter-specific (see tools/ifc.ts). This
 * is the alternative: mesh the model (via geometryCache, shared with clash)
 * with geometry hashing on, and read the enclosed volume @ifc-lite/geometry
 * proves for each entity as a byproduct of that pass.
 *
 * That proof only succeeds for entities whose meshed geometry is a single
 * closed, orientable, single-component solid — measured at ~71% coverage on
 * a real corpus. Absence is not zero: an open shell, a material-layered wall,
 * or a multi-item assembly all mesh fine but yield no proved volume. Callers
 * MUST treat `volumeM3: null` as "unknown", never as zero, and the aggregate
 * below only sums what was proved.
 */
import type { LoadedModel } from '@ifc-lite/mcp';
import type { MeshData } from '@ifc-lite/geometry';
import { meshModel } from './geometryCache';

export interface ElementVolume {
  expressId: number;
  globalId: string;
  name: string;
  type: string;
  /** Proved enclosed volume in cubic metres, or null when the kernel could not prove one. */
  volumeM3: number | null;
}

export interface TypeVolumeSummary {
  type: string;
  elementCount: number;
  provedCount: number;
  /** Sum of proved volumes only — elements with volumeM3: null are excluded, not treated as zero. */
  totalVolumeM3: number;
}

export interface VolumeExtraction {
  elements: ElementVolume[];
  byType: TypeVolumeSummary[];
  provedCount: number;
  totalCount: number;
}

/** expressId -> proved volume, from both regular meshes and GPU-instanced-only entities. */
export function collectVolumesByExpressId(
  meshes: MeshData[],
  instancedVolumes: Map<number, number>,
): Map<number, number> {
  const byExpressId = new Map<number, number>();
  for (const mesh of meshes) {
    // All submeshes of one entity carry the identical whole-entity volume;
    // take the first rather than summing, which would multiply it by the
    // entity's material/CSG-part count.
    if (mesh.geometryVolume != null && !byExpressId.has(mesh.expressId)) {
      byExpressId.set(mesh.expressId, mesh.geometryVolume);
    }
  }
  for (const [expressId, volume] of instancedVolumes) {
    byExpressId.set(expressId, volume);
  }
  return byExpressId;
}

/** Group per-element volumes into a proved-only sum per IFC type. */
export function summarizeByType(elements: ElementVolume[]): TypeVolumeSummary[] {
  const byType = new Map<string, TypeVolumeSummary>();
  for (const el of elements) {
    let bucket = byType.get(el.type);
    if (!bucket) byType.set(el.type, (bucket = { type: el.type, elementCount: 0, provedCount: 0, totalVolumeM3: 0 }));
    bucket.elementCount++;
    if (el.volumeM3 != null) {
      bucket.provedCount++;
      bucket.totalVolumeM3 += el.volumeM3;
    }
  }
  return [...byType.values()].sort((a, z) => z.totalVolumeM3 - a.totalVolumeM3);
}

export interface ExtractVolumesOptions {
  /** Restrict to one IFC type (includes subtypes, matching model.bim.query().byType). */
  type?: string;
}

/** Mesh the model (or reuse the cached mesh) and pair every element with its proved volume, if any. */
export async function extractVolumes(model: LoadedModel, opts: ExtractVolumesOptions = {}): Promise<VolumeExtraction> {
  const { meshes, instancedVolumes } = await meshModel(model);
  const volumeByExpressId = collectVolumesByExpressId(meshes, instancedVolumes);

  let query = model.bim.query();
  if (opts.type) query = query.byType(opts.type);

  const elements: ElementVolume[] = query.toArray().map((el) => ({
    expressId: el.ref.expressId,
    globalId: el.globalId,
    name: el.name,
    type: el.type,
    volumeM3: volumeByExpressId.get(el.ref.expressId) ?? null,
  }));

  return {
    elements,
    byType: summarizeByType(elements),
    provedCount: elements.filter((e) => e.volumeM3 != null).length,
    totalCount: elements.length,
  };
}
