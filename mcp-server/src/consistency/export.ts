/**
 * Report export as .xlsx, .docx or .md — written locally with the same
 * hand-built OOXML approach the extract tests use (fflate zip, no Office
 * library), and never uploaded to Dalux.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { consistencyReportDir } from '../cachePaths';
import type { Finding } from './compare';
import type { ReportManifest } from './report';

export type ExportFormat = 'xlsx' | 'docx' | 'md';

const COLUMNS = [
  'Finding ID', 'Severity', 'Type', 'Subject', 'Attribute', 'File', 'Location', 'Quote', 'Value', 'Verdict', 'Explanation', 'Precedence note',
];

function statementRows(findings: readonly Finding[]): string[][] {
  return findings.flatMap((finding) =>
    finding.statements.map((statement) => [
      finding.id,
      finding.severity,
      finding.type,
      finding.subject,
      finding.attribute,
      statement.fileName,
      statement.location,
      statement.quote,
      statement.value ?? '',
      finding.verdict,
      finding.explanation ?? '',
      finding.precedenceNote ?? '',
    ]),
  );
}

function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function toXlsx(findings: readonly Finding[]): Uint8Array {
  const rows = [COLUMNS, ...statementRows(findings)];
  const sheetRows = rows
    .map((cells, r) => {
      const rendered = cells
        .map((value, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`)
        .join('');
      return `<row r="${r + 1}">${rendered}</row>`;
    })
    .join('');
  const lastCell = `${columnName(COLUMNS.length - 1)}${rows.length}`;
  const widths = [14, 9, 18, 28, 18, 30, 22, 60, 14, 11, 50, 40]
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('');

  return zip({
    '[Content_Types].xml':
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<sheets><sheet name="Inconsistencies" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/styles.xml':
      `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '</styleSheet>',
    'xl/worksheets/sheet1.xml':
      `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${widths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`,
  });
}

function bySeverity(findings: readonly Finding[]): string {
  const count = (severity: string) => findings.filter((finding) => finding.severity === severity).length;
  return `${findings.length} finding(s): ${count('high')} high, ${count('medium')} medium, ${count('low')} low.`;
}

function scopeLine(manifest: ReportManifest): string {
  const { scope } = manifest;
  return [
    `Project ${scope.projectId}, file area ${scope.fileAreaId}`,
    scope.folderPath ? `folder ${scope.folderPath}` : null,
    `${Object.keys(manifest.files).length} file(s) analyzed`,
    manifest.complete ? null : 'analysis incomplete',
  ].filter(Boolean).join(' · ');
}

function paragraph(text: string, style?: string, bold = false): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const runProperties = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${properties}<w:r>${runProperties}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function cell(paragraphs: string[], bold = false): string {
  const body = paragraphs.length ? paragraphs.map((text) => paragraph(text, undefined, bold)).join('') : paragraph('');
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${body}</w:tc>`;
}

export function toDocx(manifest: ReportManifest, findings: readonly Finding[]): Uint8Array {
  const header = `<w:tr>${['#', 'Severity / type', 'Finding', 'Statements', 'Verdict'].map((text) => cell([text], true)).join('')}</w:tr>`;
  const rows = findings
    .map((finding, index) =>
      `<w:tr>${[
        cell([String(index + 1), finding.id]),
        cell([finding.severity, finding.type]),
        cell([finding.summary]),
        cell(finding.statements.map((s) => `${s.fileName} — ${s.location}: "${s.quote}"${s.value ? ` (${s.value})` : ''}`)),
        cell([finding.verdict, finding.explanation ?? '', finding.precedenceNote ?? ''].filter(Boolean)),
      ].join('')}</w:tr>`,
    )
    .join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
    .join('');
  const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${header}${rows}</w:tbl>`;
  const body = [
    paragraph('Document consistency report', 'Heading1'),
    paragraph(scopeLine(manifest)),
    paragraph(bySeverity(findings)),
    paragraph(
      'Verdict "candidate" means found by automatic comparison and not yet reviewed; "confirmed" means confirmed by the analysis model. Check every finding against the quoted documents before acting on it.',
    ),
    findings.length ? table : paragraph('No inconsistencies found.'),
  ].join('');

  return zip({
    '[Content_Types].xml':
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/_rels/document.xml.rels':
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'word/styles.xml':
      `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '</w:styles>',
    'word/document.xml':
      `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`,
  });
}

function md(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

export function toMarkdown(manifest: ReportManifest, findings: readonly Finding[]): string {
  const lines = [
    '# Document consistency report',
    '',
    scopeLine(manifest),
    '',
    bySeverity(findings),
    '',
  ];
  findings.forEach((finding, index) => {
    lines.push(`## ${index + 1}. [${finding.severity}] ${finding.summary}`, '');
    lines.push(`- ID: \`${finding.id}\` · type: ${finding.type} · verdict: ${finding.verdict}`);
    if (finding.explanation) lines.push(`- Explanation: ${finding.explanation}`);
    if (finding.precedenceNote) lines.push(`- Precedence: ${finding.precedenceNote}`);
    lines.push('', '| File | Location | Value | Quote |', '| --- | --- | --- | --- |');
    for (const s of finding.statements) {
      lines.push(`| ${md(s.fileName)} | ${md(s.location)} | ${md(s.value ?? '')} | ${md(s.quote)} |`);
    }
    lines.push('');
  });
  if (!findings.length) lines.push('No inconsistencies found.', '');
  return lines.join('\n');
}

/** Write the export next to the report and return its local path. */
export function writeExport(manifest: ReportManifest, findings: readonly Finding[], format: ExportFormat): { fileName: string; filePath: string } {
  const dir = path.join(consistencyReportDir(manifest.reportId), 'exports');
  mkdirSync(dir, { recursive: true });
  const fileName = `consistency-report-${manifest.reportId}.${format}`;
  const filePath = path.join(dir, fileName);
  const content =
    format === 'xlsx' ? toXlsx(findings) : format === 'docx' ? toDocx(manifest, findings) : toMarkdown(manifest, findings);
  writeFileSync(filePath, content);
  return { fileName, filePath };
}
