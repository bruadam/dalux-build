/**
 * Toolsets: named groups of tools a deployment enables, so a host lists (and
 * the model pays tokens for) only the groups it needs. This file is the one
 * place a tool is assigned to a group; test/toolsets.test.ts checks that every
 * registered tool is in exactly one toolset.
 *
 * Select with DALUX_MCP_TOOLSETS / --toolsets (stdio and http) or the
 * `?toolsets=` query parameter on the HTTP endpoint: a comma-separated list of
 * toolset names, `default`, or `all`. `core` is always enabled.
 */
export const TOOLSETS = {
  core: [
    'get_skill',
    'report_feedback',
    'list_projects',
    'get_project',
    'find_project_by_name',
    'search_projects_by_name',
    'list_project_users',
    'get_user',
    'list_project_companies',
  ],
  files: [
    'list_file_areas',
    'get_file_area',
    'list_folders',
    'search_folders_by_name',
    'get_folder',
    'get_folder_by_path',
    'get_folder_tree',
    'list_files_in_folder',
    'list_files',
    'search_files_by_name',
    'get_file',
    'download_file',
    'search_file_content',
    'render_pdf_page',
  ],
  tasks: [
    'list_project_tasks',
    'search_tasks',
    'get_task',
    'list_task_changes',
    'list_task_attachments',
    'download_task_attachment',
    'view_tasks_timeline',
  ],
  forms: ['list_forms', 'get_form'],
  quality: ['list_test_plans', 'list_test_plan_registrations', 'list_inspection_plans'],
  scheduling: ['list_work_packages', 'list_version_sets'],
  search: [
    'build_file_area_index',
    'search_file_area',
    'list_file_area_indexes',
    'drop_file_area_index',
    'build_task_index',
    'search_task_index',
    'list_task_indexes',
    'drop_task_index',
  ],
  consistency: [
    'check_document_consistency',
    'list_inconsistencies',
    'export_inconsistency_report',
    'list_consistency_reports',
    'drop_consistency_report',
  ],
  docs: ['search_docs', 'list_docs_indexes'],
  ifc: [
    'ifc_model_info',
    'ifc_discover_properties',
    'ifc_property_values',
    'ifc_query_elements',
    'ifc_schedule',
    'ifc_clash_rules_list',
    'ifc_clash_rules_save',
    'ifc_clash_rules_delete',
    'ifc_clash_start',
    'ifc_clash_result',
    'ifc_volumes_start',
    'ifc_volumes_result',
    'ifc_diff',
    'ifc_edit_start',
    'ifc_edit_apply',
    'ifc_edit_review',
    'ifc_edit_save',
    'view_model_3d',
    'ifc_viewer_geometry',
    'ifc_viewer_element',
    'ifc_viewer_selection',
  ],
  legacy: ['search_pdf_content'],
} as const satisfies Record<string, readonly string[]>;

export type Toolset = keyof typeof TOOLSETS;

/** One line per toolset, shown in the get_skill overview. */
export const TOOLSET_SUMMARIES: Record<Toolset, string> = {
  core: 'projects, users, companies, get_skill, report_feedback',
  files: 'file areas, folders, files, download, single-document search, PDF page render',
  tasks: 'task lists, search, changes, attachments, timeline view',
  forms: 'forms',
  quality: 'test plans, registrations, inspection plans',
  scheduling: 'work packages, version sets',
  search: 'local cross-document and cross-task search indexes',
  consistency: 'contradictions between documents of a file area',
  docs: 'reference-docs corpus search (laws, standards, guidelines)',
  ifc: 'IFC model analysis, clash, volumes, diff, property editing, 3D viewer',
  legacy: 'search_pdf_content (old name of search_file_content)',
};

export const TOOLSET_NAMES = Object.keys(TOOLSETS) as Toolset[];

/** What a server enables when no toolsets are configured. */
export const DEFAULT_TOOLSETS: readonly Toolset[] = ['core', 'files', 'tasks', 'forms', 'quality', 'scheduling'];

function isToolset(name: string): name is Toolset {
  return Object.hasOwn(TOOLSETS, name);
}

/**
 * Parses a comma-separated selection ("files,ifc", "default,ifc", "all") into
 * toolset names. Empty or undefined means the default. Throws on an unknown name.
 */
export function parseToolsets(selection: string | undefined): Toolset[] {
  const names = (selection ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  if (!names.length) return [...DEFAULT_TOOLSETS];
  const selected = new Set<Toolset>(['core']);
  for (const name of names) {
    if (name === 'all') TOOLSET_NAMES.forEach((toolset) => selected.add(toolset));
    else if (name === 'default') DEFAULT_TOOLSETS.forEach((toolset) => selected.add(toolset));
    else if (isToolset(name)) selected.add(name);
    else throw new Error(`Unknown toolset "${name}". Known: ${TOOLSET_NAMES.join(', ')}, default, all.`);
  }
  return TOOLSET_NAMES.filter((toolset) => selected.has(toolset));
}

export function toolsInToolsets(toolsets: readonly Toolset[]): Set<string> {
  return new Set(toolsets.flatMap((toolset) => TOOLSETS[toolset]));
}
