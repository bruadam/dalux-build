/** Human-readable grant scope; NULL means the whole level. */
export function scopeLabel(row: { projectId: string | null; fileAreaId: string | null; folderId: string | null }): string {
  if (!row.projectId) return 'Whole connection';
  const parts = [`project ${row.projectId}`];
  if (row.fileAreaId) parts.push(`file area ${row.fileAreaId}`);
  if (row.folderId) parts.push(`folder ${row.folderId}`);
  return parts.join(' / ');
}
