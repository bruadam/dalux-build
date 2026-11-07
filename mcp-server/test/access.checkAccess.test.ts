import { checkAccess } from '../src/access/checkAccess';
import { UNRESTRICTED_CONTEXT, type EffectiveAccess, type RequestContext } from '../src/access/context';
import { TOOL_ACCESS } from '../src/access/registry';

function grant(capability: EffectiveAccess['capability'], scope: Partial<EffectiveAccess> = {}): EffectiveAccess {
  return { connectionId: 'c1', capability, projectId: null, fileAreaId: null, folderId: null, ...scope };
}

function user(...access: EffectiveAccess[]): RequestContext {
  return { account: { id: 'a1', role: 'user' }, connection: { id: 'c1' }, access };
}

const file = { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' };

describe('checkAccess', () => {
  it('allows everything in unrestricted mode', () => {
    expect(checkAccess(UNRESTRICTED_CONTEXT, 'build_task_index', { projectId: 'p1' })).toEqual({ allowed: true });
    expect(checkAccess(UNRESTRICTED_CONTEXT, 'get_file', file).allowed).toBe(true);
  });

  it('denies without the capability and names it', () => {
    const decision = checkAccess(user(grant('tasks:read')), 'get_file', file);
    expect(decision).toEqual({ allowed: false, reason: expect.stringContaining('files:read') });
  });

  it('lets a wider scope cover a narrower one', () => {
    expect(checkAccess(user(grant('files:read')), 'get_file', file).allowed).toBe(true);
    expect(checkAccess(user(grant('files:read', { projectId: 'p1' })), 'get_file', file).allowed).toBe(true);
    expect(checkAccess(user(grant('files:read', { projectId: 'p1', fileAreaId: 'fa1' })), 'get_file', file).allowed).toBe(true);
    expect(checkAccess(user(grant('files:read', { projectId: 'p2' })), 'get_file', file).allowed).toBe(false);
    expect(checkAccess(user(grant('files:read', { projectId: 'p1', fileAreaId: 'fa2' })), 'get_file', file).allowed).toBe(false);
  });

  it('takes the union of grants', () => {
    const context = user(grant('tasks:read', { projectId: 'p1' }), grant('tasks:read', { projectId: 'p2' }));
    expect(checkAccess(context, 'list_project_tasks', { projectId: 'p1' }).allowed).toBe(true);
    expect(checkAccess(context, 'list_project_tasks', { projectId: 'p2' }).allowed).toBe(true);
    expect(checkAccess(context, 'list_project_tasks', { projectId: 'p3' }).allowed).toBe(false);
  });

  it('ignores grants on other connections', () => {
    const context = user({ ...grant('projects:read'), connectionId: 'c2' });
    expect(checkAccess(context, 'get_project', { projectId: 'p1' }).allowed).toBe(false);
  });

  it('lets a folder grant cover the folder and everything below it', () => {
    const context = user(grant('files:read', { projectId: 'p1', fileAreaId: 'fa1', folderId: 'design' }));
    const inFolder = { projectId: 'p1', fileAreaId: 'fa1', folderId: 'design' };
    expect(checkAccess(context, 'list_files_in_folder', inFolder).allowed).toBe(true);
    expect(checkAccess(context, 'get_folder', { ...inFolder, folderId: 'other' }).allowed).toBe(false);
  });

  it('uses folder ancestry for files below a granted folder', () => {
    const context = user(grant('files:read', { projectId: 'p1', fileAreaId: 'fa1', folderId: 'design' }));
    const tool = 'get_folder';
    expect(checkAccess(context, tool, { projectId: 'p1', fileAreaId: 'fa1', folderId: 'geometry' }).allowed).toBe(false);

    // The registry only reads ids from arguments; the folder ancestry comes from Dalux, so the
    // check is exercised here with a resolver result that carries it.
    const scopes = jest
      .spyOn(TOOL_ACCESS[tool], 'scopes')
      .mockReturnValue([{ projectId: 'p1', fileAreaId: 'fa1', folderId: 'geometry', folderAncestorIds: ['root', 'design'] }]);
    expect(checkAccess(context, tool, {}).allowed).toBe(true);
    scopes.mockRestore();
  });

  it('applies folder and file-area grants only to files capabilities', () => {
    const context = user(grant('tasks:read', { projectId: 'p1', fileAreaId: 'fa1' }));
    expect(checkAccess(context, 'list_project_tasks', { projectId: 'p1' }).allowed).toBe(false);
  });

  it('allows a listing when the caller can see part of it', () => {
    const context = user(grant('projects:read', { projectId: 'p1' }));
    expect(checkAccess(context, 'list_projects', {}).allowed).toBe(true);
    expect(checkAccess(context, 'get_project', {}).allowed).toBe(false);

    const folderOnly = user(grant('files:read', { projectId: 'p1', fileAreaId: 'fa1', folderId: 'design' }));
    expect(checkAccess(folderOnly, 'list_files', { projectId: 'p1', fileAreaId: 'fa1' }).allowed).toBe(true);
    expect(checkAccess(folderOnly, 'list_files', { projectId: 'p1', fileAreaId: 'fa2' }).allowed).toBe(false);
  });

  it('resolves every model of a multi-model call', () => {
    expect(
      TOOL_ACCESS.ifc_diff.scopes({
        projectId: 'p1',
        base: { fileAreaId: 'fa1', fileId: 'f1' },
        head: { fileAreaId: 'fa2', fileId: 'f2' },
      }),
    ).toEqual([
      { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' },
      { projectId: 'p1', fileAreaId: 'fa2', fileId: 'f2' },
    ]);
    const args = { projectId: 'p1', models: [{ fileAreaId: 'fa1', fileId: 'f1' }] };
    expect(checkAccess(user(grant('models:read', { projectId: 'p1' })), 'ifc_clash_start', args).allowed).toBe(true);
    expect(checkAccess(user(grant('models:read', { projectId: 'p2' })), 'ifc_clash_start', args).allowed).toBe(false);
  });

  it('accepts a call naming no resource when the capability is held anywhere', () => {
    expect(checkAccess(user(grant('models:read', { projectId: 'p1' })), 'ifc_clash_result', { jobId: 'j1' }).allowed).toBe(true);
    expect(checkAccess(user(), 'ifc_clash_result', { jobId: 'j1' }).allowed).toBe(false);
  });

  it('keeps admin-only tools for admins, who still need the capability', () => {
    const args = { projectId: 'p1' };
    expect(checkAccess(user(grant('tasks:read')), 'build_task_index', args).allowed).toBe(false);
    const admin: RequestContext = { ...user(grant('tasks:read')), account: { id: 'a1', role: 'admin' } };
    expect(checkAccess(admin, 'build_task_index', args).allowed).toBe(true);
    expect(checkAccess({ ...admin, access: [] }, 'build_task_index', args).allowed).toBe(false);
  });

  it('allows tools that read no project data', () => {
    expect(checkAccess(user(), 'search_docs', { query: 'fire' }).allowed).toBe(true);
    expect(checkAccess(user(), 'get_skill', {}).allowed).toBe(true);
  });
});
