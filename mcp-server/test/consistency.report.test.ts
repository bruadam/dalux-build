import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { DaluxClient } from 'dalux-build-api';

import { runWithContext } from '../src/access/requestScope';
import * as consistency from '../src/tools/consistency';
import { _resetDownloadLinksForTests } from '../src/downloadLinks';
import type { Finding } from '../src/consistency/compare';
import { paragraph, writeDocx, writeXlsx } from './fixtures/office';
import { writePdf } from './fixtures/pdf';

interface FakeFile {
  fileId: string;
  fileName: string;
  source: string;
  contentHash?: string;
}

function fakeClient(files: FakeFile[]) {
  const downloadFileFromLink = jest.fn(async (link: string, name: string, dir: string) => {
    const source = files.find((file) => file.fileId === link.replace('link:', ''))!.source;
    const target = path.join(dir, name);
    copyFileSync(source, target);
    return target;
  });
  const client = {
    files: {
      listFiles: jest.fn(async () => ({
        items: files.map((file) => ({
          fileId: file.fileId,
          fileName: file.fileName,
          folderId: 'root',
          fileType: 'document',
          contentHash: file.contentHash ?? 'v1',
          downloadLink: `link:${file.fileId}`,
          fileSize: 1024,
          deleted: false,
        })),
        metadata: { totalRemainingItems: 0 },
      })),
      downloadFileFromLink,
      getFile: jest.fn(),
    },
    folders: {
      listFolders: jest.fn(async () => ({ items: [], metadata: { totalRemainingItems: 0 } })),
      getFolderByPath: jest.fn(),
    },
  };
  return { client: client as unknown as DaluxClient, downloadFileFromLink };
}

const describeFinding = (finding: Finding) =>
  `${finding.type} ${finding.severity} ${finding.subject} ${finding.attribute}: ${finding.statements
    .map((s) => `${s.fileName}=${s.value}`)
    .sort()
    .join(' / ')}`;

describe('document consistency report', () => {
  let fixtures: string;
  let cache: string;
  let files: FakeFile[];
  const saved = { cache: process.env.DALUX_MCP_CACHE_DIR, key: process.env.MISTRAL_API_KEY };
  const args = { projectId: 'p1', fileAreaId: 'fa1', useModel: false };

  beforeAll(() => {
    fixtures = mkdtempSync(path.join(tmpdir(), 'dalux-consistency-fixtures-'));
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-consistency-cache-'));
    process.env.DALUX_MCP_CACHE_DIR = cache;
    delete process.env.MISTRAL_API_KEY;

    const doorSchedule = writeXlsx(fixtures, 'doerliste.xlsx', [
      {
        name: 'Døre',
        rows: [
          ['Dør', 'Brandklasse', 'Bredde (mm)'],
          ['D-101', 'EI60', '1.200'],
          ['D-102', 'EI30', '1000'],
        ],
      },
      {
        name: 'Tilbudsliste',
        rows: [
          ['Pos', 'Tekst', 'Mængde', 'Enhed'],
          ['3.2', 'Terrændæk', '1200', 'm2'],
        ],
      },
    ]);
    const specification = writeDocx(
      fixtures,
      'beskrivelse.docx',
      [
        paragraph('Dør D-101 udføres som EI30 med bredde 1,2 m.'),
        paragraph('Dør D-102 udføres som EI 30.'),
        paragraph('Beregninger efter DS/EN 1992-1-1:2005+AC:2010.'),
        paragraph('Aflevering af byggeriet sker den 1. marts 2027.'),
        paragraph('Se tegning A-101 rev. C for detaljer.'),
      ].join(''),
    );
    const tenderLetter = writePdf(fixtures, 'udbudsbrev.pdf', [
      [
        'Aflevering af byggeriet sker den 01-03-2027.',
        'Beregninger efter DS/EN 1992-1-1:2005.',
        'Se tegning A-101 rev. B for detaljer.',
      ],
    ]);
    const timeSchedule = path.join(fixtures, 'tidsplan.csv');
    writeFileSync(timeSchedule, 'Aktivitet;Tidspunkt\nAflevering af byggeriet;uge 12 2027\n');
    const boq = path.join(fixtures, 'tilbudsliste.csv');
    writeFileSync(boq, 'Pos;Tekst;Mængde;Enhed\n3.2;Terrændæk;1.234,5;m2\n');

    files = [
      { fileId: 'f1', fileName: 'doerliste.xlsx', source: doorSchedule },
      { fileId: 'f2', fileName: 'beskrivelse.docx', source: specification },
      { fileId: 'f3', fileName: 'udbudsbrev.pdf', source: tenderLetter },
      { fileId: 'f4', fileName: 'tidsplan.csv', source: timeSchedule },
      { fileId: 'f5', fileName: 'tilbudsliste.csv', source: boq },
    ];
  });

  afterAll(async () => {
    await _resetDownloadLinksForTests();
    if (saved.cache === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = saved.cache;
    if (saved.key !== undefined) process.env.MISTRAL_API_KEY = saved.key;
    rmSync(fixtures, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  it('stops showing findings that quote a file the caller can no longer see (restricted callers)', async () => {
    const caller = { account: { id: 'a1', role: 'user' as const }, connection: { id: 'c1' }, access: [], fileNamespace: 'restricted-caller' };
    const { client } = fakeClient(files);
    const { reportId } = await runWithContext(caller, () => consistency.checkDocumentConsistency(client, args));
    const all = await runWithContext(caller, () => consistency.listInconsistencies(client, { reportId }));
    expect(all.total).toBeGreaterThan(0);

    // The grant shrank: Dalux (through the restricted client) now lists everything but f1.
    const narrowed = fakeClient(files.filter((file) => file.fileId !== 'f1')).client;
    const after = await runWithContext(caller, () => consistency.listInconsistencies(narrowed, { reportId }));
    expect(after.total).toBeLessThan(all.total);
    expect(JSON.stringify(after.findings)).not.toContain('doerliste.xlsx');
    const exported = await runWithContext(caller, () => consistency.exportInconsistencyReport(narrowed, { reportId, format: 'md' }));
    expect(readFileSync(exported.filePath, 'utf-8')).not.toContain('doerliste.xlsx');

    // Callers without a request scope (stdio) are unaffected.
    expect((await consistency.listInconsistencies(narrowed, { reportId })).total).toBe(all.total);
  });

  it('finds each kind of conflict across files, without flagging equal values written differently', async () => {
    const { client } = fakeClient(files);
    const result = await consistency.checkDocumentConsistency(client, args);
    expect(result).toMatchObject({ complete: true, filesInScope: 5, filesAnalyzed: 5, skipped: [], findingsCount: 5 });
    expect(result.bySeverity).toEqual({ high: 3, medium: 2, low: 0 });

    const { total, findings } = await consistency.listInconsistencies(client, { reportId: result.reportId });
    expect(total).toBe(5);
    // D-101's width (1.200 mm vs 1,2 m), D-102's fire class (EI30 vs EI 30) and the
    // handover date (1. marts 2027 vs 01-03-2027) agree and must not be reported.
    expect(findings.map(describeFinding)).toEqual([
      'value_conflict high D-101 fire_class: beskrivelse.docx=EI30 / doerliste.xlsx=EI60',
      'reference_conflict high DS/EN 1992-1-1 edition: beskrivelse.docx=2005+AC:2010 / udbudsbrev.pdf=2005',
      'date_conflict high project handover_date: beskrivelse.docx=2027-03-01 / tidsplan.csv=2027-W12 / udbudsbrev.pdf=2027-03-01',
      'revision_conflict medium A-101 revision: beskrivelse.docx=C / udbudsbrev.pdf=B',
      'quantity_conflict medium item 3.2 (Terrændæk) quantity: doerliste.xlsx=1200 m2 / tilbudsliste.csv=1234.5 m2',
    ]);
    for (const finding of findings) {
      expect(finding.verdict).toBe('candidate');
      expect(new Set(finding.statements.map((s) => s.fileId)).size).toBeGreaterThanOrEqual(2);
    }
    const fire = findings[0].statements.find((s) => s.fileId === 'f2')!;
    expect(fire.quote).toBe('Dør D-101 udføres som EI30 med bredde 1,2 m.');
    const pdf = findings[1].statements.find((s) => s.fileId === 'f3')!;
    expect(pdf.location).toMatch(/p\. ?1/);
    expect(pdf.quote).toContain('DS/EN 1992-1-1:2005');

    const high = await consistency.listInconsistencies(client, { reportId: result.reportId, severity: 'high', type: 'date_conflict' });
    expect(high.findings.map((f) => f.attribute)).toEqual(['handover_date']);
    const csv = await consistency.listInconsistencies(client, { reportId: result.reportId, fileId: 'f5' });
    expect(csv.total).toBe(1);
    const page = await consistency.listInconsistencies(client, { reportId: result.reportId, offset: 4, limit: 10 });
    expect(page).toMatchObject({ total: 5, findings: [{ type: 'quantity_conflict' }] });
  });

  it('only reports the requested focus and file subset', async () => {
    const { client } = fakeClient(files);
    const result = await consistency.checkDocumentConsistency(client, { ...args, focus: ['fire', 'dates'], fileIds: ['f1', 'f2', 'f4', 'missing'] });
    const { findings } = await consistency.listInconsistencies(client, { reportId: result.reportId });
    expect(findings.map((f) => `${f.subject} ${f.attribute}`)).toEqual(['D-101 fire_class', 'project handover_date']);
    expect(result.warnings.join(' ')).toContain('missing');
  });

  it('resumes within a budget and re-reads only changed revisions', async () => {
    const scoped = { ...args, folderPath: undefined, extensions: ['.xlsx', '.docx', '.csv'] };
    const { client, downloadFileFromLink } = fakeClient(files);
    const first = await consistency.checkDocumentConsistency(client, { ...scoped, maxFiles: 2 });
    expect(first).toMatchObject({ complete: false, filesInScope: 4, filesAnalyzed: 2 });
    expect(first.nextStep).toContain('again');
    const second = await consistency.checkDocumentConsistency(client, { ...scoped, maxFiles: 2 });
    expect(second).toMatchObject({ reportId: first.reportId, complete: true, filesAnalyzed: 4 });
    expect(downloadFileFromLink).toHaveBeenCalledTimes(4);

    const unchanged = await consistency.checkDocumentConsistency(client, scoped);
    expect(unchanged).toMatchObject({ complete: true, filesAnalyzedThisPass: 0, findingsCount: second.findingsCount });

    const equalQuantity = path.join(fixtures, 'tilbudsliste-rev2.csv');
    writeFileSync(equalQuantity, 'Pos;Tekst;Mængde;Enhed\n3.2;Terrændæk;1.200,0;m2\n');
    const revised = fakeClient(files.map((f) => (f.fileId === 'f5' ? { ...f, source: equalQuantity, contentHash: 'v2' } : f)));
    const third = await consistency.checkDocumentConsistency(revised.client, scoped);
    expect(third).toMatchObject({ reportId: first.reportId, filesAnalyzedThisPass: 1, findingsCount: second.findingsCount - 1 });
    expect(revised.downloadFileFromLink).toHaveBeenCalledTimes(1);
  });

  it('exports xlsx, docx and md reports locally', async () => {
    const { client } = fakeClient(files);
    const { reportId } = await consistency.checkDocumentConsistency(client, args);

    const xlsx = await consistency.exportInconsistencyReport(client, { reportId, format: 'xlsx' });
    expect(xlsx).toMatchObject({ reportId, format: 'xlsx', findingsCount: 5 });
    expect(xlsx.fileName).toMatch(/\.xlsx$/);
    expect(xlsx.downloadUrl).toMatch(/^http/);
    const sheet = strFromU8(unzipSync(readFileSync(xlsx.filePath))['xl/worksheets/sheet1.xml']);
    expect((sheet.match(/<row /g) ?? []).length).toBe(1 + 11);
    expect(sheet).toContain('Dør D-101 udføres som EI30 med bredde 1,2 m.');

    const docx = await consistency.exportInconsistencyReport(client, { reportId, format: 'docx' });
    const body = strFromU8(unzipSync(readFileSync(docx.filePath))['word/document.xml']);
    expect(body).toContain('D-101');
    expect(body).toContain('udbudsbrev.pdf');

    const md = await consistency.exportInconsistencyReport(client, { reportId, format: 'md' });
    const markdown = readFileSync(md.filePath, 'utf-8');
    expect(markdown).toContain('DS/EN 1992-1-1');
    expect(markdown).toContain('tidsplan.csv');
  });

  it('lists and drops reports', async () => {
    const { client } = fakeClient(files);
    const { reportId } = await consistency.checkDocumentConsistency(client, args);
    expect((await consistency.listConsistencyReports()).reports.map((r) => r.reportId)).toContain(reportId);
    expect((await consistency.dropConsistencyReport(client, { reportId })).dropped).toBe(true);
    expect((await consistency.dropConsistencyReport(client, { reportId })).dropped).toBe(false);
    await expect(consistency.listInconsistencies(client, { reportId })).rejects.toThrow(/No consistency report/);
  });
});
