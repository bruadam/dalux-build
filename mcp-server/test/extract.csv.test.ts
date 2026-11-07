import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractDocument, isSupported } from '../src/extract';
import { parseCsv, sniffDelimiter } from '../src/extract/csv';

describe('extract/csv', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-csv-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is a supported extension', () => {
    expect(isSupported('tilbudsliste.CSV')).toBe(true);
  });

  it('sniffs the semicolon used by Danish exports even when cells contain decimal commas', () => {
    expect(sniffDelimiter('Pos;Tekst;Mængde\n1.1;Beton C30/37;1.234,5\n1.2;Armering;12,5\n')).toBe(';');
    expect(sniffDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(sniffDelimiter('a\tb\n1\t2\n')).toBe('\t');
  });

  it('honours quoted fields with embedded delimiters, quotes and newlines', () => {
    expect(parseCsv('a;"b;c";"say ""hi"""\r\n"multi\nline";2;3', ';')).toEqual([
      ['a', 'b;c', 'say "hi"'],
      ['multi\nline', '2', '3'],
    ]);
  });

  it('labels cells with the header row and keeps Danish number formats verbatim', async () => {
    const file = path.join(dir, 'boq.csv');
    writeFileSync(file, '\uFEFFPos;Tekst;Mængde;Enhed\n1.1;Beton C30/37;1.234,5;m3\n1.2;Armering;12,5;t\n');
    const result = await extractDocument(file);
    expect(result.format).toBe('csv');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].location).toBe('rows 2–3');
    expect(result.chunks[0].text).toContain('Columns: Pos | Tekst | Mængde | Enhed');
    expect(result.chunks[0].text).toContain('Row 2: Pos=1.1 | Tekst=Beton C30/37 | Mængde=1.234,5 | Enhed=m3');
  });

  it('falls back to Windows-1252 for non-UTF-8 exports', async () => {
    const file = path.join(dir, 'latin.csv');
    writeFileSync(file, Buffer.from('Rum;Bem\xe6rkning\nR1;D\xf8r\n', 'latin1'));
    const result = await extractDocument(file);
    expect(result.chunks[0].text).toContain('Bemærkning=Dør');
  });
});
