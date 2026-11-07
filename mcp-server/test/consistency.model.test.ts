import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import * as consistency from '../src/tools/consistency';
import { paragraph, writeDocx, writeXlsx } from './fixtures/office';

const complete = jest.fn();
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({ chat: { complete } })),
}));

type Request = { model: string; messages: { role: string; content: string }[]; responseFormat: { jsonSchema: { name: string } } };
const reply = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });

function fakeClient(files: { fileId: string; fileName: string; source: string }[]) {
  return {
    files: {
      listFiles: jest.fn(async () => ({
        items: files.map((file) => ({
          fileId: file.fileId,
          fileName: file.fileName,
          folderId: 'root',
          fileType: 'document',
          contentHash: 'v1',
          downloadLink: `link:${file.fileId}`,
          fileSize: 1024,
          deleted: false,
        })),
        metadata: { totalRemainingItems: 0 },
      })),
      downloadFileFromLink: jest.fn(async (link: string, name: string, dir: string) => {
        const target = path.join(dir, name);
        copyFileSync(files.find((file) => `link:${file.fileId}` === link)!.source, target);
        return target;
      }),
      getFile: jest.fn(),
    },
    folders: { listFolders: jest.fn(async () => ({ items: [], metadata: { totalRemainingItems: 0 } })), getFolderByPath: jest.fn() },
  } as unknown as DaluxClient;
}

describe('document consistency with Mistral', () => {
  let fixtures: string;
  let cache: string;
  let files: { fileId: string; fileName: string; source: string }[];
  const saved = {
    cache: process.env.DALUX_MCP_CACHE_DIR,
    key: process.env.MISTRAL_API_KEY,
    model: process.env.DALUX_MCP_ANALYSIS_MODEL,
    allow: process.env.DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO,
  };

  beforeAll(() => {
    fixtures = mkdtempSync(path.join(tmpdir(), 'dalux-consistency-model-'));
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.DALUX_MCP_ANALYSIS_MODEL = 'test-model';
    process.env.DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO = 'true';
    files = [
      {
        fileId: 'f1',
        fileName: 'doerliste.xlsx',
        source: writeXlsx(fixtures, 'doerliste.xlsx', [
          { name: 'Døre', rows: [['Dør', 'Brandklasse'], ['D-101', 'EI60']] },
          { name: 'Tilbudsliste', rows: [['Pos', 'Tekst', 'Mængde', 'Enhed'], ['3.2', 'Terrændæk', '1200', 'm2']] },
        ]),
      },
      {
        fileId: 'f2',
        fileName: 'beskrivelse.docx',
        source: writeDocx(
          fixtures,
          'beskrivelse.docx',
          [paragraph('Dør D-101 udføres som EI30.'), paragraph('Terrændækket (tilbudslistens post 3.2) omfatter i alt tretten hundrede kvadratmeter.')].join(''),
        ),
      },
    ];
  });

  beforeEach(() => {
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-consistency-model-cache-'));
    process.env.DALUX_MCP_CACHE_DIR = cache;
    complete.mockReset();
  });

  afterEach(() => rmSync(cache, { recursive: true, force: true }));

  afterAll(() => {
    for (const [name, value] of [
      ['DALUX_MCP_CACHE_DIR', saved.cache],
      ['MISTRAL_API_KEY', saved.key],
      ['DALUX_MCP_ANALYSIS_MODEL', saved.model],
      ['DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO', saved.allow],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(fixtures, { recursive: true, force: true });
  });

  it('adds model-extracted facts and applies the judge verdicts', async () => {
    complete.mockImplementation(async (request: Request) => {
      const user = request.messages[1].content;
      if (request.responseFormat.jsonSchema.name === 'document_facts') {
        return reply({
          facts: user.includes('beskrivelse.docx')
            ? [{ subject: 'post 3.2', attribute: 'quantity', value: '1.300', unit: 'm2', location: 'nowhere', quote: 'Terrændækket (tilbudslistens post 3.2) omfatter i alt tretten hundrede kvadratmeter.' }]
            : [],
        });
      }
      return reply(
        user.includes('fire_class')
          ? { verdict: 'confirmed', explanation: 'EI60 og EI30 er forskellige krav.', precedenceNote: 'Beskrivelsen går forud for dørlisten.' }
          : { verdict: 'not_a_conflict', explanation: 'Ca.-mængde i beskrivelsen.', precedenceNote: '' },
      );
    });

    const client = fakeClient(files);
    const result = await consistency.checkDocumentConsistency(client, { projectId: 'p1', fileAreaId: 'fa1' });
    expect(result).toMatchObject({ complete: true, mode: 'deterministic+model', findingsCount: 1, dismissedByModel: 1 });
    expect(result.topFindings[0]).toMatchObject({
      attribute: 'fire_class',
      verdict: 'confirmed',
      explanation: 'EI60 og EI30 er forskellige krav.',
      precedenceNote: 'Beskrivelsen går forud for dørlisten.',
    });

    const requests = complete.mock.calls.map(([request]) => request as Request);
    expect(requests.every((request) => request.model === 'test-model')).toBe(true);
    const judgeRequests = requests.filter((request) => request.responseFormat.jsonSchema.name === 'consistency_judgment');
    expect(judgeRequests).toHaveLength(2);
    expect(judgeRequests[0].messages[0].content).toContain('Danish construction contracts');

    complete.mockClear();
    const again = await consistency.checkDocumentConsistency(client, { projectId: 'p1', fileAreaId: 'fa1' });
    expect(again).toMatchObject({ complete: true, findingsCount: 1, filesAnalyzedThisPass: 0 });
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps pattern findings as candidates when Mistral fails', async () => {
    complete.mockRejectedValue(new Error('401 Unauthorized'));
    const result = await consistency.checkDocumentConsistency(fakeClient(files), { projectId: 'p1', fileAreaId: 'fa1' });
    expect(result).toMatchObject({ complete: false, findingsCount: 1 });
    expect(result.topFindings[0]).toMatchObject({ attribute: 'fire_class', verdict: 'candidate' });
    expect(result.warnings.join(' ')).toContain('401 Unauthorized');
  });

  it('skips the model when useModel is false', async () => {
    const result = await consistency.checkDocumentConsistency(fakeClient(files), { projectId: 'p1', fileAreaId: 'fa1', useModel: false });
    expect(result).toMatchObject({ complete: true, mode: 'deterministic', findingsCount: 1 });
    expect(complete).not.toHaveBeenCalled();
  });

  it('falls back to deterministic checks when DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO is not true', async () => {
    delete process.env.DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO;
    try {
      const result = await consistency.checkDocumentConsistency(fakeClient(files), { projectId: 'p1', fileAreaId: 'fa1' });
      expect(result).toMatchObject({ complete: true, mode: 'deterministic', findingsCount: 1 });
      expect(result.warnings.join(' ')).toContain('DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO');
      expect(complete).not.toHaveBeenCalled();
    } finally {
      process.env.DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO = 'true';
    }
  });

  it('stops model extraction inside a large file at the time budget and resumes it on the next call', async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => paragraph(`Afsnit ${i}: ${'tekst om udførelse og kvalitet '.repeat(6)}`));
    const big = {
      fileId: 'f3',
      fileName: 'tilbudsliste.docx',
      source: writeDocx(fixtures, 'tilbudsliste.docx', [paragraph('Dør D-101 skal være EI60 ifølge denne liste.'), ...paragraphs].join('')),
    };
    const small = { fileId: 'f2', fileName: 'beskrivelse.docx', source: files[1].source };
    let now = Date.parse('2026-11-07T12:00:00Z');
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    complete.mockImplementation(async (request: Request) => {
      const user = request.messages[1].content;
      if (request.responseFormat.jsonSchema.name !== 'document_facts') {
        return reply({ verdict: 'confirmed', explanation: 'EI60 mod EI30.', precedenceNote: '' });
      }
      now += 200_000;
      const quote = 'Dør D-101 skal være EI60 ifølge denne liste.';
      return reply({
        facts: user.includes(quote) ? [{ subject: 'D-101', attribute: 'fire_class', value: 'EI60', unit: '', location: 'nowhere', quote }] : [],
      });
    });

    try {
      const client = fakeClient([small, big]);
      const args = { projectId: 'p1', fileAreaId: 'fa1', timeBudgetSeconds: 120 };
      const first = await consistency.checkDocumentConsistency(client, args);
      expect(first.complete).toBe(false);
      expect(first.warnings.join(' ')).toContain('partly read by Mistral');

      let result = first;
      for (let pass = 0; pass < 10 && !result.complete; pass += 1) {
        result = await consistency.checkDocumentConsistency(client, args);
      }
      expect(result).toMatchObject({ complete: true, findingsCount: 1 });
      expect(result.topFindings[0]).toMatchObject({ attribute: 'fire_class', verdict: 'confirmed' });

      const bigBatches = complete.mock.calls
        .map(([request]) => request as Request)
        .filter((request) => request.responseFormat.jsonSchema.name === 'document_facts' && request.messages[1].content.includes('tilbudsliste.docx'))
        .map((request) => request.messages[1].content);
      expect(bigBatches.length).toBeGreaterThan(1);
      expect(new Set(bigBatches).size).toBe(bigBatches.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('compares model and pattern standard editions and national annexes in the same form', async () => {
    const a = writeDocx(fixtures, 'statik.docx', paragraph('Laster efter DS/EN 1991-1-1:2007 + DK NA:2013.'));
    const b = writeDocx(fixtures, 'konstruktion.docx', paragraph('Nyttelast iht. DS/EN 1991-1-1:2007, NA:2013.'));
    complete.mockImplementation(async (request: Request) => {
      if (request.responseFormat.jsonSchema.name !== 'document_facts') {
        return reply({ verdict: 'confirmed', explanation: '', precedenceNote: '' });
      }
      const quote = 'Laster efter DS/EN 1991-1-1:2007 + DK NA:2013.';
      return reply({
        facts: request.messages[1].content.includes('statik.docx')
          ? [
              { subject: 'DS/EN 1991-1-1', attribute: 'edition', value: 'DS/EN 1991-1-1:2007 + DK NA:2013', unit: '', location: 'nowhere', quote },
              { subject: 'DS/EN 1991-1-1', attribute: 'national_annex', value: 'DS/EN 1991-1-1 DK NA:2013', unit: '', location: 'nowhere', quote },
            ]
          : [],
      });
    });
    const client = fakeClient([
      { fileId: 's1', fileName: 'statik.docx', source: a },
      { fileId: 's2', fileName: 'konstruktion.docx', source: b },
    ]);
    const result = await consistency.checkDocumentConsistency(client, { projectId: 'p1', fileAreaId: 'fa1' });
    expect(result).toMatchObject({ complete: true, findingsCount: 0, dismissedByModel: 0 });
  });
});
