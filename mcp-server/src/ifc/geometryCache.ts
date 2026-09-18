/**
 * Shared tessellation cache: the one place that meshes a LoadedModel.
 *
 * Meshing is the expensive step (minutes on a cold multi-MB model, per
 * clashEngine.ts), so it happens once per model instance and the result is
 * reused by every consumer that needs it — clash detection and, since
 * geometry hashing was turned on here, proved per-entity volumes (#1993 in
 * @ifc-lite/geometry) too. Splitting this into a clash-only cache and a
 * volume-only cache would mesh the same model twice for a caller that runs
 * both tools.
 *
 * Geometry hashing is enabled unconditionally: per @ifc-lite/geometry's own
 * docs it rides the same WASM batch pass as tessellation rather than
 * re-tessellating, so the extra cost is far smaller than meshing itself, and
 * clash ignores the extra MeshData fields it populates.
 */
import { readFile } from 'node:fs/promises';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { MeshData } from '@ifc-lite/geometry';
import { loadIfcGeometry } from './runtime';

export interface ModelGeometry {
  meshes: MeshData[];
  /**
   * Proved enclosed volumes (m³) for entities that went entirely to the
   * GPU-instanced shard and so never appear in `meshes` at all (see
   * GeometryResult.instancedGeometryVolumes). Keyed by expressId.
   */
  instancedVolumes: Map<number, number>;
}

const cache = new WeakMap<LoadedModel, ModelGeometry>();

/** Mesh (and hash/volume-fingerprint) a model, memoised against the LoadedModel instance. */
export async function meshModel(model: LoadedModel): Promise<ModelGeometry> {
  const cached = cache.get(model);
  if (cached) return cached;

  if (!model.filePath) {
    throw new Error(`Model ${model.id} has no file path to mesh.`);
  }
  const bytes = await readFile(model.filePath);
  const geometry = await loadIfcGeometry();
  const gp = new geometry.GeometryProcessor();
  gp.enableGeometryHashes();
  try {
    await gp.init();
    const result = await gp.process(bytes);
    if (result.meshes.length === 0) {
      throw new Error(
        `No mesh geometry could be produced for model ${model.id}; this needs tessellated solids.`,
      );
    }
    const geometryResult: ModelGeometry = {
      meshes: result.meshes,
      instancedVolumes: result.instancedGeometryVolumes ?? new Map(),
    };
    cache.set(model, geometryResult);
    return geometryResult;
  } finally {
    gp.dispose();
  }
}
