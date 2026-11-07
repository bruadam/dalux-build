import type { EffectiveAccess, RequestContext } from './context';
import { TOOL_ACCESS, type Capability, type ResourceScope } from './registry';

export type AccessDecision = { allowed: true } | { allowed: false; reason: string };

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

export function checkAccess(context: RequestContext, toolName: string, args: Record<string, unknown>): AccessDecision {
  if (context.access === 'unrestricted') return { allowed: true };

  const tool = TOOL_ACCESS[toolName];
  if (!tool) return { allowed: false, reason: `Tool ${toolName} has no access rule.` };
  if (tool.adminOnly && context.account?.role !== 'admin') {
    return { allowed: false, reason: `${toolName} is only available to admins.` };
  }
  const { capability } = tool;
  if (capability === 'none') return { allowed: true };

  const grants = context.access.filter(
    (grant) => grant.capability === capability && grant.connectionId === context.connection?.id,
  );
  const denied: AccessDecision = { allowed: false, reason: `Missing capability ${capability} for this resource.` };
  if (!grants.length) return denied;

  for (const scope of tool.scopes(args).map((s) => effectiveScope(capability, s))) {
    if (grants.some((grant) => covers(grant, scope))) continue;
    if (tool.filtersOutput && grants.some((grant) => within(grant, scope))) continue;
    return denied;
  }
  return { allowed: true };
}
