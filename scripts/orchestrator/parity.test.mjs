// Extractor tests. These exist because the first version of parity.mjs
// reported `folders.if` and `files.close` as API surface -- a JS `if (` at
// method indent, and a Protocol stub in the same module. Name-level extraction
// looks trivial and is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsMethods, pyMethods, toSnake, jsFileToGroup, pyFileToGroup } from './parity.mjs';

test('toSnake bridges the two naming conventions', () => {
  assert.equal(toSnake('listProjects'), 'list_projects');
  assert.equal(toSnake('getFileAreaTree'), 'get_file_area_tree');
  assert.equal(toSnake('already_snake'), 'already_snake');
});

test('file names map onto a shared group key', () => {
  assert.equal(jsFileToGroup('FileRevisionsApi.ts'), 'file_revisions');
  assert.equal(jsFileToGroup('ProjectsApi.ts'), 'projects');
  assert.equal(pyFileToGroup('file_revisions.py'), 'file_revisions');
});

test('jsMethods ignores control flow at method indent', () => {
  const src = [
    'export class FoldersApi {',
    '  constructor(c) { this.c = c; }',
    '  async getFolders(id) {',
    '    if (!id) return null;',
    '    for (const x of []) {}',
    '    return this.c.get(id);',
    '  }',
    '  _private() {}',
    '}',
  ].join('\n');
  assert.deepEqual([...jsMethods(src)].sort(), ['get_folders']);
});

test('jsMethods reads generics and public modifiers', () => {
  const src = ['export class TasksApi {', '  public async listTasks<T>(p) {}', '}'].join('\n');
  assert.deepEqual([...jsMethods(src)], ['list_tasks']);
});

test('pyMethods ignores helper classes in the same module', () => {
  const src = [
    'class _ProgressBar(Protocol):',
    '    def update(self, n: float) -> bool | None: ...',
    '    def close(self) -> None: ...',
    '',
    'class FilesApi(AiMixin):',
    '    def __init__(self, c) -> None:',
    '        self.c = c',
    '    def list_files(self, *, project_id=None):',
    '        return None',
    '    def _helper(self):',
    '        return None',
  ].join('\n');
  assert.deepEqual([...pyMethods(src)].sort(), ['list_files']);
});

test('pyMethods collapses overload stubs into one surface method', () => {
  const src = [
    'class ProjectsApi:',
    '    @overload',
    '    def get_projects(self, *, a: int) -> None: ...',
    '    @overload',
    '    def get_projects(self, *, b: str) -> None: ...',
    '    def get_projects(self, **kw):',
    '        return None',
  ].join('\n');
  assert.deepEqual([...pyMethods(src)], ['get_projects']);
});
