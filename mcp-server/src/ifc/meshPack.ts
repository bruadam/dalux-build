/**
 * Binary packing of tessellated IFC meshes for the 3D viewer MCP App.
 *
 * The server meshes a model once (ifc-lite geometry) and ships it to the
 * viewer iframe through host-proxied tool calls, so there is no URL the
 * browser has to reach and nothing for the host's CSP to allow. Each chunk is
 * one self-describing little-endian buffer; `packEncodedChunks` splits by
 * encoded size so a single tool result stays small, and `unpackChunk` (also
 * bundled into the browser app) reads it back without copying the big arrays.
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

/** Raw bytes of one mesh piece. Small enough that one piece always fits a chunk, even if it does not compress at all. */
export const MAX_PIECE_BYTES = 64 * 1024;

/** Splits a mesh whose packed size exceeds `maxBytes` into triangle ranges, each with only the vertices it uses. */
export function splitMesh(mesh: PackableMesh, maxBytes = MAX_PIECE_BYTES): PackableMesh[] {
  if (meshBytes(mesh) <= maxBytes) return [mesh];
  // Worst case a triangle brings 3 new vertices: 3 × 4 index bytes + 3 × 12 position bytes.
  const trianglesPerPiece = Math.max(1, Math.floor((maxBytes - 20) / 48));
  const pieces: PackableMesh[] = [];
  for (let start = 0; start < mesh.indices.length; start += 3 * trianglesPerPiece) {
    const slice = mesh.indices.subarray(start, start + 3 * trianglesPerPiece);
    const remap = new Map<number, number>();
    const indices = new Uint32Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      let local = remap.get(slice[i]);
      if (local === undefined) remap.set(slice[i], (local = remap.size));
      indices[i] = local;
    }
    const positions = new Float32Array(3 * remap.size);
    for (const [src, dst] of remap) positions.set(mesh.positions.subarray(3 * src, 3 * src + 3), 3 * dst);
    pieces.push({ ...mesh, positions, indices });
  }
  return pieces;
}

/**
 * Packs `meshes` into chunks whose `encode`d form is at most `maxEncodedChars`
 * long. Big meshes are split first (see `splitMesh`), so an element can span
 * several entries and chunks. Chunk sizes follow the compression ratio seen so
 * far; a chunk that still encodes too long is retried with fewer meshes.
 */
export function packEncodedChunks(
  meshes: PackableMesh[],
  maxEncodedChars: number,
  encode: (chunk: Uint8Array) => string,
): { types: string[]; chunks: string[] } {
  const types = [...new Set(meshes.map((mesh) => mesh.ifcType ?? ''))].sort();
  const typeIndex = new Map(types.map((type, i) => [type, i]));
  const pieces = meshes.flatMap((mesh) => splitMesh(mesh));
  const chunks: string[] = [];
  let charsPerByte = 1;
  for (let start = 0; start < pieces.length; ) {
    let budget = (0.9 * maxEncodedChars) / charsPerByte;
    for (;;) {
      let end = start;
      let bytes = 0;
      while (end < pieces.length && (end === start || bytes + meshBytes(pieces[end]) <= budget)) bytes += meshBytes(pieces[end++]);
      const raw = packOne(pieces.slice(start, end), typeIndex);
      const encoded = encode(raw);
      if (encoded.length <= maxEncodedChars || end - start === 1) {
        if (encoded.length > maxEncodedChars) throw new Error(`mesh piece encodes to ${encoded.length} chars, over ${maxEncodedChars}`);
        chunks.push(encoded);
        charsPerByte = encoded.length / raw.byteLength;
        start = end;
        break;
      }
      budget = (bytes * 0.9 * maxEncodedChars) / encoded.length;
    }
  }
  return { types, chunks };
}

/** Reads a chunk produced by `packEncodedChunks` (after decoding). `bytes` must start 4-byte aligned. */
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
