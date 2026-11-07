/**
 * Cross-document consistency checks: find statements in different documents
 * of a file area that contradict each other (a door's fire class, a BoQ
 * quantity, a handover date, a cited standard's edition). Read-only towards
 * Dalux — reports live in the local cache and exports are local files.
 */

import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { FOCUS_AREAS } from '../consistency/compare';
import { writeAnnotatedExport } from '../consistency/annotate';
import { writeExport } from '../consistency/export';
import {
  DEFAULT_CONSISTENCY_EXTENSIONS,
  checkConsistency,
  dropReport,
  listReports,
  readFindings,
  readReportManifest,
  reportIdFor,
} from '../consistency/report';
import { createDownloadLink } from '../downloadLinks';
import { resolveScope } from '../rag/scope';

// ---------- check_document_consistency ----------

export const checkDocumentConsistencyInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  folderPath: z
    .string()
    .optional()
    .describe('Folder (with subfolders) by full path: file area name, root folder, subfolders, e.g. "Files/Files/2_Udbud". Default: whole file area.'),
  fileIds: z.array(z.string()).optional().describe('Only compare these files.'),
  extensions: z
    .array(z.string())
    .optional()
    .describe(`Formats to read (default ${DEFAULT_CONSISTENCY_EXTENSIONS.join(', ')}).`),
  focus: z
    .array(z.enum(FOCUS_AREAS))
    .optional()
    .describe('Only report these kinds of conflict (default all).'),
  maxFiles: z.number().int().min(1).max(2000).optional().describe('Max files to read in this call (default 100).'),
  timeBudgetSeconds: z
    .number()
    .int()
    .min(10)
    .max(900)
    .optional()
    .describe('Stop this pass after about this long (default 120).'),
  useModel: z
    .boolean()
    .optional()
    .describe('Use Mistral to extract facts and judge findings (default: on when the server allows it).'),
});
export type CheckDocumentConsistencyInput = z.infer<typeof checkDocumentConsistencyInput>;

export async function checkDocumentConsistency(client: DaluxClient, args: CheckDocumentConsistencyInput) {
  const scope = await resolveScope(client, {
    projectId: args.projectId,
    fileAreaId: args.fileAreaId,
    folderPath: args.folderPath,
    extensions: args.extensions ?? DEFAULT_CONSISTENCY_EXTENSIONS,
  });
  const result = await checkConsistency(
    client,
    {
      ...scope,
      fileIds: args.fileIds?.length ? [...new Set(args.fileIds)] : null,
      focus: args.focus?.length ? [...new Set(args.focus)] : null,
    },
    { maxFiles: args.maxFiles, timeBudgetSeconds: args.timeBudgetSeconds, useModel: args.useModel },
  );
  return {
    ...result,
    nextStep: result.complete
      ? `Page through the findings with list_inconsistencies (reportId "${result.reportId}") or export them with export_inconsistency_report.`
      : 'Call check_document_consistency again with the same arguments to continue.',
  };
}

// ---------- list_inconsistencies ----------

export const listInconsistenciesInput = z.object({
  reportId: z.string().describe('As returned by check_document_consistency.'),
  severity: z.enum(['high', 'medium', 'low']).optional(),
  type: z
    .enum(['value_conflict', 'quantity_conflict', 'date_conflict', 'reference_conflict', 'revision_conflict', 'other'])
    .optional(),
  fileId: z.string().optional().describe('Only findings with a statement from this file.'),
  offset: z.number().int().min(0).optional().describe('Skip this many findings (default 0).'),
  limit: z.number().int().min(1).max(200).optional().describe('Max findings to return (default 50).'),
});
export type ListInconsistenciesInput = z.infer<typeof listInconsistenciesInput>;

export async function listInconsistencies(_client: DaluxClient, args: ListInconsistenciesInput) {
  const findings = readFindings(args.reportId).filter(
    (finding) =>
      (!args.severity || finding.severity === args.severity) &&
      (!args.type || finding.type === args.type) &&
      (!args.fileId || finding.statements.some((statement) => statement.fileId === args.fileId)),
  );
  const offset = args.offset ?? 0;
  return { total: findings.length, findings: findings.slice(offset, offset + (args.limit ?? 50)) };
}

// ---------- export_inconsistency_report ----------

export const exportInconsistencyReportInput = z.object({
  reportId: z.string().describe('As returned by check_document_consistency.'),
  format: z
    .enum(['xlsx', 'docx', 'md', 'annotated-pdf'])
    .describe(
      'xlsx: one row per statement; docx: summary and table; md: markdown; annotated-pdf: zip with a copy of each affected PDF ' +
        '(quotes highlighted, comment naming the conflicting value) plus the xlsx register.',
    ),
});
export type ExportInconsistencyReportInput = z.infer<typeof exportInconsistencyReportInput>;

export async function exportInconsistencyReport(client: DaluxClient, args: ExportInconsistencyReportInput) {
  const findings = readFindings(args.reportId);
  const manifest = readReportManifest(args.reportId);
  if (!manifest) throw new Error(`No consistency report "${args.reportId}" on this server.`);
  if (args.format === 'annotated-pdf') {
    const { fileName, filePath, annotatedFiles, unmatchedQuotes } = await writeAnnotatedExport(client, manifest, findings);
    return {
      reportId: args.reportId,
      format: args.format,
      fileName,
      filePath,
      downloadUrl: await createDownloadLink(filePath, fileName),
      findingsCount: findings.length,
      annotatedFiles,
      unmatchedQuotes,
    };
  }
  const { fileName, filePath } = writeExport(manifest, findings, args.format);
  return {
    reportId: args.reportId,
    format: args.format,
    fileName,
    filePath,
    downloadUrl: await createDownloadLink(filePath, fileName),
    findingsCount: findings.length,
  };
}

// ---------- list_consistency_reports / drop_consistency_report ----------

export const listConsistencyReportsInput = z.object({});
export type ListConsistencyReportsInput = z.infer<typeof listConsistencyReportsInput>;

export async function listConsistencyReports() {
  return { reports: listReports() };
}

export const dropConsistencyReportInput = z.object({
  reportId: z.string().describe('The report to delete, as reported by list_consistency_reports.'),
});
export type DropConsistencyReportInput = z.infer<typeof dropConsistencyReportInput>;

export async function dropConsistencyReport(_client: DaluxClient, args: DropConsistencyReportInput) {
  const dropped = dropReport(args.reportId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local consistency report "${args.reportId}". Nothing in Dalux was changed.`
      : `No consistency report "${args.reportId}" on this server.`,
  };
}

export { reportIdFor };
