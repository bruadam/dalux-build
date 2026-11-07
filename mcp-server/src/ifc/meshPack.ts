/**
 * Binary packing of tessellated IFC meshes for the 3D viewer MCP App.
 *
 * The server meshes a model once (ifc-lite geometry) and ships it to the
 * viewer iframe through host-proxied tool calls, so there is no URL the
 * browser has to reach and nothing for the host's CSP to allow. Each chunk is
 * one self-describing little-endian buffer; `packChunks` splits by size so a
 * single tool result stays small, and `unpackChunk` (also bundled into the
 * browser app) reads it back without copying the big arrays.
 *
 * Positions are written in the model's shared frame (per-mesh `origin` added).
 *
 * Layout (all 4-byte aligned): Uint32 header [meshCount, vertexCount,
 * indexCount], then per mesh: expressId, vertexCount, indexCount, typeIndex
 * (Uint32 each), RGBA (Uint8 ×4); then positions (Float32 ×3 per vertex) and
 * indices (Uint32, rebased so they address the chunk's vertex array).
 */

export interface PackableMesh {
  expressId: number;
  ifcType?: string;
  /** Positions are relative to this offset (ifc-lite's per-mesh RTC origin); packing adds it back. */
  origin?: ArrayLike<number>;
  positions: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
}

export interface UnpackedChunk {
  expressIds: Uint32Array;
  vertexCounts: Uint32Array;
  indexCounts: Uint32Array;
  typeIndices: Uint32Array;
  colors: Uint8Array;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface PackedModel {
  /** IFC class names, addressed by each mesh's typeIndex. */
  types: string[];
  chunks: Uint8Array[];
}

const HEADER_WORDS = 3;

function meshBytes(mesh: PackableMesh): number {
  return 20 + mesh.positions.byteLength + mesh.indices.byteLength;
}

function packOne(meshes: PackableMesh[], typeIndex: Map<string, number>): Uint8Array {
  const m = meshes.length;
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.positions.length / 3;
    indexCount += mesh.indices.length;
  }
  const buffer = new ArrayBuffer(4 * HEADER_WORDS + 20 * m + 12 * vertexCount + 4 * indexCount);
  const header = new Uint32Array(buffer, 0, HEADER_WORDS);
  header.set([m, vertexCount, indexCount]);
  let offset = 4 * HEADER_WORDS;
  const ids = new Uint32Array(buffer, offset, m);
  const vCounts = new Uint32Array(buffer, (offset += 4 * m), m);
  const iCounts = new Uint32Array(buffer, (offset += 4 * m), m);
  const types = new Uint32Array(buffer, (offset += 4 * m), m);
  const colors = new Uint8Array(buffer, (offset += 4 * m), 4 * m);
  const positions = new Float32Array(buffer, (offset += 4 * m), 3 * vertexCount);
  const indices = new Uint32Array(buffer, offset + 12 * vertexCount, indexCount);

  let vBase = 0;
  let iBase = 0;
  meshes.forEach((mesh, k) => {
    const verts = mesh.positions.length / 3;
    ids[k] = mesh.expressId;
    vCounts[k] = verts;
    iCounts[k] = mesh.indices.length;
    types[k] = typeIndex.get(mesh.ifcType ?? '') ?? 0;
    for (let c = 0; c < 4; c++) colors[4 * k + c] = Math.round(Math.min(1, Math.max(0, mesh.color[c])) * 255);
    positions.set(mesh.positions, 3 * vBase);
    if (mesh.origin) {
      const o = mesh.origin;
      for (let i = 3 * vBase; i < 3 * (vBase + verts); i += 3) {
        positions[i] += o[0];
        positions[i + 1] += o[1];
        positions[i + 2] += o[2];
      }
    }
    for (let i = 0; i < mesh.indices.length; i++) indices[iBase + i] = mesh.indices[i] + vBase;
    vBase += verts;
    iBase += mesh.indices.length;
  });
  return new Uint8Array(buffer);
}

/** Splits `meshes` into chunks of roughly `maxChunkBytes` (a single larger mesh gets a chunk of its own). */
export function packChunks(meshes: PackableMesh[], maxChunkBytes: number): PackedModel {
  const types = [...new Set(meshes.map((mesh) => mesh.ifcType ?? ''))].sort();
  const typeIndex = new Map(types.map((type, i) => [type, i]));
  const chunks: Uint8Array[] = [];
  let current: PackableMesh[] = [];
  let size = 0;
  for (const mesh of meshes) {
    const bytes = meshBytes(mesh);
    if (current.length > 0 && size + bytes > maxChunkBytes) {
      chunks.push(packOne(current, typeIndex));
      current = [];
      size = 0;
    }
    current.push(mesh);
    size += bytes;
  }
  if (current.length > 0) chunks.push(packOne(current, typeIndex));
  return { types, chunks };
}

/** Reads a chunk produced by `packChunks`. `bytes` must start 4-byte aligned. */
export function unpackChunk(bytes: Uint8Array): UnpackedChunk {
  const { buffer, byteOffset } = bytes;
  const [m, vertexCount, indexCount] = new Uint32Array(buffer, byteOffset, HEADER_WORDS);
  let offset = byteOffset + 4 * HEADER_WORDS;
  const expressIds = new Uint32Array(buffer, offset, m);
  const vertexCounts = new Uint32Array(buffer, (offset += 4 * m), m);
  const indexCounts = new Uint32Array(buffer, (offset += 4 * m), m);
  const typeIndices = new Uint32Array(buffer, (offset += 4 * m), m);
  const colors = new Uint8Array(buffer, (offset += 4 * m), 4 * m);
  const positions = new Float32Array(buffer, (offset += 4 * m), 3 * vertexCount);
  const indices = new Uint32Array(buffer, offset + 12 * vertexCount, indexCount);
  return { expressIds, vertexCounts, indexCounts, typeIndices, colors, positions, indices };
}
