import { extractFacts } from '../src/consistency/facts';
import { datesAgree, normalizeDate, parseNumber } from '../src/consistency/normalize';

const chunk = (text: string, location = 'p. 1') => ({ page: 1, location, text });
const pick = (facts: ReturnType<typeof extractFacts>) =>
  facts.map((fact) => `${fact.subjectKey} ${fact.attribute}=${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`);

describe('consistency/normalize', () => {
  it.each([
    ['1.200', 1200],
    ['1,2', 1.2],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['12.5', 12.5],
    ['1 200', 1200],
    ['abc', null],
  ])('parseNumber(%s)', (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it('reads Danish, ISO and week dates', () => {
    expect(normalizeDate('01-03-2027')).toBe('2027-03-01');
    expect(normalizeDate('1. marts 2027')).toBe('2027-03-01');
    expect(normalizeDate('2027-03-01')).toBe('2027-03-01');
    expect(normalizeDate('uge 12 2027')).toBe('2027-W12');
    expect(normalizeDate('31-02-2027')).toBeNull();
    expect(datesAgree('2027-03-22', '2027-W12')).toBe(true);
    expect(datesAgree('2027-03-01', '2027-W12')).toBe(false);
  });
});

describe('consistency/facts', () => {
  it('ties fire classes and dimensions in prose to the nearest door ID', () => {
    const facts = extractFacts([chunk('Dør D-101 udføres som EI 60 med bredde 1,2 m. Dør D-102 skal være EI30-C.')]);
    expect(pick(facts)).toEqual(['D101 fire_class=EI60', 'D101 width=1200 mm', 'D102 fire_class=EI30-C']);
    expect(facts[0].quote).toBe('Dør D-101 udføres som EI 60 med bredde 1,2 m.');
  });

  it('reads labelled spreadsheet rows with a subject column', () => {
    const facts = extractFacts([
      chunk('[Sheet: Døre]\nColumns: Dør | Brandklasse | Bredde (mm)\nRow 2: Dør=D101 | Brandklasse=EI60 | Bredde (mm)=1.200', 'Døre!rows 2–2'),
    ]);
    expect(pick(facts)).toEqual(['D101 fire_class=EI60', 'D101 width=1200 mm']);
    expect(facts[0].location).toBe('Døre!row 2');
  });

  it('reads BoQ rows into item quantities with the unit column', () => {
    const facts = extractFacts([chunk('Row 3: Pos=3.2 | Tekst=Terrændæk C25/30 | Mængde=1.234,5 | Enhed=m²', 'rows 3–3')]);
    expect(pick(facts)).toEqual(['ITEM:3.2 concrete_class=C25/30', 'ITEM:3.2 quantity=1234.5 m2']);
    expect(facts[0].subjectLabel).toBe('item 3.2 (Terrændæk C25/30)');
  });

  it('reads Word table rows using the header row as labels', () => {
    const facts = extractFacts([chunk('Dør | Brandklasse | Højde\nD-101 | EI30 | 2100')]);
    expect(pick(facts)).toEqual(['D101 fire_class=EI30', 'D101 height=2100 mm']);
  });

  it('extracts keyworded milestone dates, stage-aware', () => {
    expect(pick(extractFacts([chunk('Aflevering af byggeriet sker den 1. marts 2027.')]))).toEqual(['PROJECT handover_date=2027-03-01']);
    expect(pick(extractFacts([chunk('Etape 2: aflevering uge 12 2027.')]))).toEqual(['PROJECT:stage 2 handover_date=2027-W12']);
    expect(extractFacts([chunk('Mødet blev holdt 03-02-2027.')])).toEqual([]);
  });

  it('extracts standard editions and national annexes, money and drawing revisions', () => {
    expect(pick(extractFacts([chunk('Beregninger efter DS/EN 1992-1-1:2005+AC:2010 og DK NA:2013.')]))).toEqual([
      'STD:1992-1-1 edition=2005+AC:2010',
    ]);
    expect(pick(extractFacts([chunk('Kontraktsummen udgør 12.500.000 kr. ekskl. moms.')]))).toEqual(['PROJECT contract_sum=12500000 DKK']);
    expect(pick(extractFacts([chunk('Se tegning A-101 rev. C for detaljer.')]))).toEqual(['A101 revision=C']);
  });

  it('ties structural classes to building elements when no ID is present', () => {
    expect(pick(extractFacts([chunk('Fundamenter udføres i beton C30/37, eksponeringsklasse XC2.')]))).toEqual([
      'ELEMENT:fundament concrete_class=C30/37',
      'ELEMENT:fundament exposure_class=XC2',
    ]);
  });

  it('does not treat classes, standards or loose numbers as subjects', () => {
    expect(extractFacts([chunk('Brandklasse EI60 jf. EN-1992 og BR-18 kapitel 5.')])).toEqual([]);
  });
});
