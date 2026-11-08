/**
 * Resolves a Dalux (projectId, fileAreaId, fileId) to a parsed ifc-lite model,
 * downloading through the same tmp cache `download_file` already uses.
 *
 * Models are kept resident deliberately. Parsing is cheap (tens of ms) but the
 * clash path tessellates the whole model and caches the meshes against the
 * LoadedModel *instance* — measured at minutes on a 2MB model, versus ~8s once
 * warm. Dropping a model throws that away, so eviction is by idle time with a
 * generous TTL rather than by count on every call.
 *
 * Those caches are process-global and keyed by fileId, so they are not an
 * access-control boundary: every call re-checks with Dalux that this caller
 * may read this file before any cached copy is served. See assertReadable.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';
import type { LoadedModel, ModelRegistry } from '@ifc-lite/mcp';

import { cacheDirFor, fileCacheScope } from '../cachePaths';
import { loadIfcLite } from './runtime';

export interface IfcRef {
  projectId: string;
  fileAreaId: string;
  fileId: string;
}

const IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_RESIDENT = 4;

interface Entry {
  model: LoadedModel;
  filePath: string;
  lastUsed: number;
}

const entries = new Map<string, Entry>();
const registries = new Map<string, Promise<ModelRegistry>>();

/** Models are registered under their file id, which is only unique within one cache scope (connection). */
function scopeKey(): string {
  return fileCacheScope() ?? '';
}

function getRegistry(): Promise<ModelRegistry> {
  const key = scopeKey();
  let registry = registries.get(key);
  if (!registry) {
    registry = loadIfcLite().then((ifc) => new ifc.InMemoryModelRegistry());
    registries.set(key, registry);
  }
  return registry;
}

/** Find an already-downloaded .ifc in the per-file cache dir, if present. */
async function cachedIfcPath(fileId: string): Promise<string | null> {
  const dir = cacheDirFor(fileId);
  if (!existsSync(dir)) return null;
  const names = await readdir(dir);
  const ifcName = names.find((n) => n.toLowerCase().endsWith('.ifc'));
  return ifcName ? path.join(dir, ifcName) : null;
}

async function downloadIfc(client: DaluxClient, ref: IfcRef): Promise<string> {
  const savePath = cacheDirFor(ref.fileId);
  const result = await client.files.getFile(ref.projectId, ref.fileAreaId, ref.fileId, {
    download: true,
    savePath,
  });
  if (typeof result === 'string') throw new Error(result);
  const downloaded = (result as Record<string, unknown>).downloadedFilePath;
  if (typeof downloaded !== 'string') throw new Error('Dalux returned no downloaded file path.');
  if (!downloaded.toLowerCase().endsWith('.ifc')) {
    throw new Error(`File ${ref.fileId} is not an IFC (got ${path.basename(downloaded)}).`);
  }
  return downloaded;
}

/**
 * Fail unless Dalux says this caller may read this file.
 *
 * Both caches below are keyed by fileId alone and live for the whole process,
 * while the HTTP transport serves one client per Dalux API key out of that one
 * process — so a cache hit must never answer a caller Dalux would have
 * refused. Without this check the first tenant to open a model exposes it to
 * every other tenant that knows its fileId, and to anyone whose access to it
 * has since been revoked, because neither cache branch talks to Dalux at all.
 *
 * The id lookup throws (NotFoundError / AuthenticationError) when the file is
 * not visible to the key, and the caller's own projectId/fileAreaId are part
 * of the request path, so pointing a foreign fileId at a project you do have
 * is refused too. It costs one metadata request against tools that otherwise
 * parse or mesh an entire model. downloadIfc repeats the lookup on the cold
 * path; that is one request against a download, and keeping the check
 * unconditional here means no branch below can forget it.
 */
export async function assertReadable(client: DaluxClient, ref: IfcRef): Promise<void> {
  const result = await client.files.getFile(ref.projectId, ref.fileAreaId, ref.fileId);
  if (result == null || typeof result === 'string') {
    throw new Error(
      `File ${ref.fileId} is not readable in project ${ref.projectId}, file area ${ref.fileAreaId}` +
        (typeof result === 'string' ? `: ${result}` : '.'),
    );
  }
}

function evictIdle(): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now - entry.lastUsed > IDLE_TTL_MS) entries.delete(key);
  }
  while (entries.size > MAX_RESIDENT) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, entry] of entries) {
      if (entry.lastUsed < oldest) { oldest = entry.lastUsed; oldestKey = key; }
    }
    if (!oldestKey) break;
    entries.delete(oldestKey);
  }
}

/** The local .ifc for `ref`, downloading it only if the shared cache has none. Assumes authorization is already checked. */
async function localIfcPath(client: DaluxClient, ref: IfcRef): Promise<string> {
  return (await cachedIfcPath(ref.fileId)) ?? (await downloadIfc(client, ref));
}

/**
 * Authorize `ref` and return the local path of its .ifc, downloading it if
 * needed — the file half of `resolveModel` without the resident-model half.
 *
 * Exported for the edit path (editSession.ts), which needs the same file and
 * the same authorization check but must parse its own private copy: the
 * resident models here are shared process-wide across every credential this
 * process serves, so queueing a mutation onto one would show another caller's
 * reads an edit they never made.
 */
export async function ensureLocalIfc(client: DaluxClient, ref: IfcRef): Promise<string> {
  await assertReadable(client, ref);
  return localIfcPath(client, ref);
}

export interface ResolvedModel {
  model: LoadedModel;
  registry: ModelRegistry;
  filePath: string;
  fileName: string;
}

/**
 * Download (or reuse) the IFC behind `ref` and return it parsed and registered.
 *
 * Authorization is re-checked on every call, before either cache is consulted
 * — see assertReadable.
 */
export async function resolveModel(client: DaluxClient, ref: IfcRef): Promise<ResolvedModel> {
  await assertReadable(client, ref);

  const registry = await getRegistry();
  const entryKey = `${scopeKey()}/${ref.fileId}`;
  const existing = entries.get(entryKey);
  if (existing) {
    existing.lastUsed = Date.now();
    return {
      model: existing.model,
      registry,
      filePath: existing.filePath,
      fileName: path.basename(existing.filePath),
    };
  }

  const filePath = await localIfcPath(client, ref);
  const ifc = await loadIfcLite();
  const model = await ifc.loadIfcModel(filePath, { modelId: ref.fileId });

  registry.add(model);
  entries.set(entryKey, { model, filePath, lastUsed: Date.now() });
  evictIdle();

  return { model, registry, filePath, fileName: path.basename(filePath) };
}

/** Length-unit scale (file units → metres). Dalux exports are typically mm (0.001). */
export function lengthScale(model: LoadedModel): number {
  const scale = (model.store as unknown as { lengthScale?: number }).lengthScale;
  return typeof scale === 'number' && scale > 0 ? scale : 1;
}
