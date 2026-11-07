import { checkAccess, type AccessDecision } from './checkAccess';
import type { RequestContext } from './context';
import type { FolderLookup } from './folders';
import { TOOL_ACCESS, type ResourceScope } from './registry';

async function withFolder(scope: ResourceScope, folders: FolderLookup): Promise<ResourceScope> {
  const { projectId, fileAreaId } = scope;
  if (!projectId || !fileAreaId) return scope;
  const folderId = scope.folderId ?? (scope.fileId ? await folders.fileFolder(projectId, fileAreaId, scope.fileId) : undefined);
  if (!folderId) return scope;
  return { ...scope, folderId, folderAncestorIds: await folders.ancestry(projectId, fileAreaId, folderId) };
}

/**
 * checkAccess, plus one cached Dalux lookup of the file's or folder's place in
 * the folder tree when only a folder grant could allow the call.
 */
export async function authorize(
  context: RequestContext,
  toolName: string,
  args: Record<string, unknown>,
  folders?: FolderLookup,
): Promise<AccessDecision> {
  const decision = checkAccess(context, toolName, args);
  if (decision.allowed || !folders || context.access === 'unrestricted') return decision;
  if (!context.access.some((grant) => grant.folderId !== null)) return decision;
  const tool = TOOL_ACCESS[toolName];
  if (!tool) return decision;
  const scopes = await Promise.all(tool.scopes(args).map((scope) => withFolder(scope, folders)));
  return checkAccess(context, toolName, args, scopes);
}
