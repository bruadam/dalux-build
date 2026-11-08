import type { EffectiveAccess, RequestContext } from './context';
import { TOOL_ACCESS, type Capability, type ResourceScope } from './registry';

export type DenialCode = 'missing_capability' | 'no_folder_access' | 'admin_only' | 'no_access_rule';

export type AccessDecision = { allowed: true } | { allowed: false; reason: string; code: DenialCode };

/** Folder and file-area scopes only apply to files:*; other areas stop at the project. */
function effectiveScope(capability: Capability, scope: ResourceScope): ResourceScope {
  return capability.startsWith('files:') ? scope : { projectId: scope.projectId };
}

function covers(grant: EffectiveAccess, scope: ResourceScope): boolean {
  return (
    (grant.projectId === null || grant.projectId === scope.projectId) &&
    (grant.fileAreaId === null || grant.fileAreaId === scope.fileAreaId) &&
    (grant.folderId === null ||
      grant.folderId === scope.folderId ||
      (scope.folderAncestorIds?.includes(grant.folderId) ?? false))
  );
}

/** The grant gives access to some part of `scope`, e.g. one project of a connection-wide listing. */
function within(grant: EffectiveAccess, scope: ResourceScope): boolean {
  return (
    (scope.projectId === undefined || grant.projectId === scope.projectId) &&
    (scope.fileAreaId === undefined || grant.fileAreaId === scope.fileAreaId) &&
    (scope.folderId === undefined || grant.folderId === scope.folderId)
  );
}

function grantsFor(context: RequestContext, capability: Capability): EffectiveAccess[] {
  if (context.access === 'unrestricted') return [];
  return context.access.filter((grant) => grant.capability === capability && grant.connectionId === context.connection?.id);
}

function coversAll(grants: EffectiveAccess[], capability: Capability, scopes: ResourceScope[], partial: boolean): boolean {
  if (!grants.length) return false;
  return scopes
    .map((s) => effectiveScope(capability, s))
    .every((scope) => grants.some((grant) => covers(grant, scope) || (partial && within(grant, scope))));
}

/** The caller may read all of `scope` with `capability`. */
export function canSee(context: RequestContext, capability: Capability, scope: ResourceScope): boolean {
  return context.access === 'unrestricted' || coversAll(grantsFor(context, capability), capability, [scope], false);
}

/** The caller may read `scope` or some part of it, e.g. one folder of a file area. */
export function reaches(context: RequestContext, capability: Capability, scope: ResourceScope): boolean {
  if (context.access === 'unrestricted') return true;
  return grantsFor(context, capability).some((grant) => covers(grant, scope) || within(grant, scope));
}

/**
 * `scopes` defaults to what the tool's resolver reads from `args`; callers pass
 * them when they have filled in folder information the arguments lack.
 */
export function checkAccess(
  context: RequestContext,
  toolName: string,
  args: Record<string, unknown>,
  scopes?: ResourceScope[],
): AccessDecision {
  if (context.access === 'unrestricted') return { allowed: true };

  const tool = TOOL_ACCESS[toolName];
  if (!tool) return { allowed: false, reason: `Tool ${toolName} has no access rule.`, code: 'no_access_rule' };
  if (tool.adminOnly && context.account?.role !== 'admin') {
    return { allowed: false, reason: `${toolName} is only available to admins.`, code: 'admin_only' };
  }
  const { capability } = tool;
  if (capability === 'none') return { allowed: true };

  const resolved = scopes ?? tool.scopes(args);
  /** The caller holds the capability, but not for this file area, folder or file. */
  const denialCode = (missing: Capability): DenialCode =>
    missing.startsWith('files:') &&
    grantsFor(context, missing).length > 0 &&
    resolved.some((scope) => scope.fileAreaId || scope.folderId || scope.fileId)
      ? 'no_folder_access'
      : 'missing_capability';
  if (!coversAll(grantsFor(context, capability), capability, resolved, tool.filtersOutput ?? false)) {
    return { allowed: false, reason: `Missing capability ${capability} for this resource.`, code: denialCode(capability) };
  }
  if (tool.readsFiles && !coversAll(grantsFor(context, 'files:read'), 'files:read', resolved, false)) {
    return { allowed: false, reason: 'Missing capability files:read for this file.', code: denialCode('files:read') };
  }
  return { allowed: true };
}
