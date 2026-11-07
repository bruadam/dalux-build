/**
 * Deterministic fact extraction: turns extracted document chunks into
 * comparable statements — "door D-101 has fire class EI60", "item 3.2 is
 * 120 m2", "handover is 2027-03-01" — each with the quote and location it came
 * from. Patterns are deliberately conservative: a fact needs a subject it can
 * be tied to (an element/room/door ID, a BoQ item, a standard, or the project
 * for keyworded dates), because an unattached "EI60" cannot be compared with
 * anything and would only produce false conflicts.
 */

import type { TextChunk } from '../extract';
import {
  DATE_PATTERN,
  lengthToMm,
  normalizeDate,
  normalizeId,
  normalizeUnit,
  parseNumber,
} from './normalize';

export interface Fact {
  subjectKey: string;
  subjectLabel: string;
  attribute: string;
  /** Canonical form used for comparison (see compare.ts). */
  value: string;
  unit?: string;
  raw: string;
  location: string;
  quote: string;
  source: 'pattern' | 'model';
}

const MAX_QUOTE = 300;

const NUMBER = String.raw`\d[\d.,]*`;

/** Prefixes that look like "XX-123" but are classes, standards or regulations, not element IDs. */
const NOT_ID_PREFIXES = new Set([
  'DS', 'EN', 'ISO', 'EI', 'REI', 'EW', 'XC', 'XD', 'XS', 'XF', 'XA', 'CE', 'NA', 'AB', 'ABT', 'DK', 'BR', 'U', 'LC', 'C',
  'BD', 'BS', 'KL', 'NR', 'NO', 'TLF', 'CVR', 'UGE', 'REV', 'PKT',
]);

const ID_PATTERN = /\b(?:([A-ZÆØÅ]{1,3})[-.](\d{1,4}(?:\.\d{1,3})?[A-Z]?)|([DVWR])(\d{3,4}[A-Z]?))\b/g;
const ITEM_PATTERN = /\b(?:post|pos\.?|item|tilbudspost)\s*(?:nr\.?\s*)?(\d{1,3}(?:\.\d{1,3}){0,4})\b/gi;
const ITEM_NUMBER = /^\d{1,3}(?:\.\d{1,3}){1,4}$/;

const FIRE_PATTERN = /\b(?:(REI|EI2?|EW|E|R)\s?-?\s?(15|20|30|45|60|90|120|180|240)((?:-?(?:C\d?|Sa|S200|M))*)|(BD|BS)[- ]?(?:dør|bygningsdel|væg)?\s?(30|60|90|120))\b/g;
const CONCRETE_PATTERN = /\bC\s?(\d{2,3})\s?\/\s?(\d{2,3})\b/g;
const EXPOSURE_PATTERN = /\bX(0|C[1-4]|D[1-3]|S[1-3]|F[1-4]|A[1-3])\b/g;
const U_VALUE_PATTERN = new RegExp(
  String.raw`\bU[- ]?(?:værdi|vaerdi|value)\s*(?:[:=≤<]|max\.?|maks\.?)?\s*(${NUMBER})|\b(${NUMBER})\s*W\s?\/\s?\(?m[²2]\s?[·*]?\s?K\)?`,
  'gi',
);
const SOUND_PATTERN = /\b(R'?w|L'?n,?w)\s*(?:\+\s*C(?:tr)?(?:,\d+-\d+)?\s*)?(?:[:=≥>≤<]|min\.?|max\.?)?\s*(\d{2})\s*dB\b/gi;
const DIMENSION_PATTERN = new RegExp(
  String.raw`\b(bredde|width|højde|hoejde|height|tykkelse|thickness|længde|laengde|length|dybde|depth|diameter)\b[^.\d]{0,25}?(${NUMBER})\s*(mm|cm|m)\b`,
  'gi',
);
const QUANTITY_PATTERN = new RegExp(String.raw`(${NUMBER})\s*(m²|m2|m³|m3|lbm|stk\.?|pcs|kg|t)(?![\wæøå])`, 'gi');
const MONEY_PATTERN = new RegExp(
  String.raw`(?:\b(?:DKK|kr\.?)\s*(${NUMBER}(?:\s\d{3})*)|(${NUMBER}(?:\s\d{3})*)\s*(?:kr\.?|DKK|,-)(?![\wæøå]))`,
  'gi',
);
const STANDARD_PATTERN =
  /\b(DS\/EN ISO|DS\/EN|DS\/ISO|EN ISO|DS|EN|ISO)\s?(\d{3,5}(?:-\d{1,3})*)((?::\s?\d{4})?(?:\s?\+\s?A[C\d]\d?(?::\s?\d{4})?)*)(?:\s*(?:,\s*)?(?:DK\s?)?NA\s?:?\s?(\d{4}))?/g;
const REVISION_AFTER_ID = /^\s*[,(]?\s*rev(?:ision)?\.?\s*[:=]?\s*([A-Z]\d?|\d{1,2})\b/i;

const ELEMENT_STEMS = [
  'terrændæk', 'etagedæk', 'fundament', 'ydervæg', 'indervæg', 'søjle', 'bjælke', 'altan', 'kælder', 'vindue',
  'foundation', 'external wall', 'column', 'beam', 'slab', 'window',
];
const ELEMENT_PATTERN = new RegExp(String.raw`\b(${ELEMENT_STEMS.join('|')})(?:e|er|en|et|erne|ene|s)?\b`, 'gi');

const DATE_KEYWORDS: [RegExp, string][] = [
  [/aflever|handover|hand-over|overdragelse/i, 'handover_date'],
  [/licitation|tilbudsfrist|tilbudsdato|tender|bid deadline/i, 'tender_deadline'],
  [/byggestart|opstart|arbejdets start|igangsætning|commencement|start/i, 'start_date'],
  [/færdigmeld|færdiggørelse|completion|ibrugtagning/i, 'completion_date'],
];
const CONTRACT_SUM = /kontraktsum|entreprisesum|tilbudssum|aftalesum|contract sum|contract price/i;
const STAGE_PATTERN = /\b(etape|stage|fase|delaflevering)\s*(\d{1,2})\b/i;

interface Subject {
  key: string;
  label: string;
  index: number;
  kind: 'id' | 'item' | 'element';
}

interface Segment {
  text: string;
  location: string;
  /** Labelled cells for spreadsheet/table rows; absent for prose. */
  cells?: { label: string; value: string }[];
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_QUOTE ? `${flat.slice(0, MAX_QUOTE - 1)}…` : flat;
}

function round(value: number): string {
  return String(Number(value.toFixed(6)));
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
}

export function findIds(text: string): Subject[] {
  return allMatches(ID_PATTERN, text).flatMap((match) => {
    const prefix = match[1] ?? match[3];
    if (NOT_ID_PREFIXES.has(prefix)) return [];
    return [{ key: normalizeId(match[0]), label: match[0], index: match.index, kind: 'id' as const }];
  });
}

function findItems(text: string): Subject[] {
  return allMatches(ITEM_PATTERN, text).map((match) => ({
    key: `ITEM:${match[1]}`,
    label: `item ${match[1]}`,
    index: match.index,
    kind: 'item' as const,
  }));
}

function findElements(text: string): Subject[] {
  return allMatches(ELEMENT_PATTERN, text).map((match) => ({
    key: `ELEMENT:${match[1].toLowerCase()}`,
    label: match[1].toLowerCase(),
    index: match.index,
    kind: 'element' as const,
  }));
}

/** The subject a value at `index` belongs to: the nearest one before it, else the first after it. */
function owner(subjects: Subject[], index: number): Subject | undefined {
  let best: Subject | undefined;
  for (const subject of subjects) {
    if (subject.index <= index) best = subject;
  }
  return best ?? subjects[0];
}

function fireClass(match: RegExpExecArray): string {
  if (match[4]) return `${match[4]}${match[5]}`;
  return `${match[1]}${match[2]}${(match[3] ?? '').replace(/^-?/, match[3] ? '-' : '').toUpperCase()}`;
}

interface Found {
  attribute: string;
  value: string;
  unit?: string;
  raw: string;
  index: number;
}

/** Values that identify their own attribute wherever they appear ("EI60", "C30/37", "XC3"). */
function selfIdentifying(text: string): Found[] {
  const found: Found[] = [];
  for (const match of allMatches(FIRE_PATTERN, text)) {
    found.push({ attribute: 'fire_class', value: fireClass(match), raw: match[0], index: match.index });
  }
  for (const match of allMatches(CONCRETE_PATTERN, text)) {
    found.push({ attribute: 'concrete_class', value: `C${match[1]}/${match[2]}`, raw: match[0], index: match.index });
  }
  const exposure = allMatches(EXPOSURE_PATTERN, text);
  if (exposure.length) {
    const classes = [...new Set(exposure.map((match) => `X${match[1]}`))].sort();
    found.push({ attribute: 'exposure_class', value: classes.join(','), raw: exposure.map((m) => m[0]).join(', '), index: exposure[0].index });
  }
  for (const match of allMatches(U_VALUE_PATTERN, text)) {
    const value = parseNumber(match[1] ?? match[2]);
    if (value !== null && value < 10) {
      found.push({ attribute: 'u_value', value: round(value), unit: 'W/m2K', raw: match[0], index: match.index });
    }
  }
  for (const match of allMatches(SOUND_PATTERN, text)) {
    const attribute = match[1].toUpperCase().startsWith('L') ? 'impact_sound' : 'sound_insulation';
    found.push({ attribute, value: match[2], unit: 'dB', raw: match[0], index: match.index });
  }
  for (const match of allMatches(DIMENSION_PATTERN, text)) {
    const number = parseNumber(match[2]);
    const mm = number === null ? null : lengthToMm(number, match[3]);
    if (mm === null) continue;
    found.push({ attribute: dimensionAttribute(match[1]), value: round(mm), unit: 'mm', raw: match[0], index: match.index });
  }
  return found;
}

function dimensionAttribute(keyword: string): string {
  const word = keyword.toLowerCase();
  if (/^(bredde|width)/.test(word)) return 'width';
  if (/^(højde|hoejde|height)/.test(word)) return 'height';
  if (/^(tykkelse|thickness)/.test(word)) return 'thickness';
  if (/^(længde|laengde|length)/.test(word)) return 'length';
  if (/^(dybde|depth)/.test(word)) return 'depth';
  return 'diameter';
}

function quantities(text: string): Found[] {
  return allMatches(QUANTITY_PATTERN, text).flatMap((match) => {
    const value = parseNumber(match[1]);
    if (value === null) return [];
    return [{ attribute: 'quantity', value: round(value), unit: normalizeUnit(match[2]), raw: match[0], index: match.index }];
  });
}

function money(text: string): { value: number; raw: string; index: number }[] {
  return allMatches(MONEY_PATTERN, text).flatMap((match) => {
    const value = parseNumber(match[1] ?? match[2]);
    return value === null ? [] : [{ value, raw: match[0], index: match.index }];
  });
}

function standards(text: string): Found[] {
  const found: Found[] = [];
  for (const match of allMatches(STANDARD_PATTERN, text)) {
    const subject = `STD:${match[2]}`;
    const edition = match[3].replace(/\s/g, '');
    if (edition) found.push({ attribute: `${subject}|edition`, value: edition.replace(/^:/, ''), raw: match[0], index: match.index });
    if (match[4]) found.push({ attribute: `${subject}|national_annex`, value: match[4], raw: match[0], index: match.index });
  }
  return found;
}

function standardLabel(raw: string): string {
  return /^(DS\/EN ISO|DS\/EN|DS\/ISO|EN ISO|DS|EN|ISO)\s?\d{3,5}(?:-\d{1,3})*/.exec(raw)?.[0] ?? raw;
}

/** Keyworded milestone dates; the keyword must come before the date in the same statement. */
function milestoneDates(text: string, preferLabels?: { label: string; value: string }[]): Found[] {
  const dates = allMatches(DATE_PATTERN, text);
  if (!dates.length) return [];
  const found: Found[] = [];
  const preferred = preferLabels?.find((cell) => /slut|end|finish|dato|date|frist/i.test(cell.label) && normalizeDate(cell.value));
  const candidates = preferred ? dates.filter((match) => match[0] === preferred.value) : dates;
  for (const match of candidates.length ? candidates : dates) {
    const before = text.slice(0, match.index);
    let attribute: string | null = null;
    let best = -1;
    for (const [pattern, name] of DATE_KEYWORDS) {
      const at = before.search(new RegExp(`(?:${pattern.source})(?![\\s\\S]*(?:${pattern.source}))`, 'i'));
      if (at > best) {
        best = at;
        attribute = name;
      }
    }
    const value = normalizeDate(match[0]);
    if (attribute && value) found.push({ attribute, value, raw: match[0], index: match.index });
  }
  return found;
}

function projectSubject(text: string): { key: string; label: string } {
  const stage = STAGE_PATTERN.exec(text);
  return stage
    ? { key: `PROJECT:stage ${stage[2]}`, label: `${stage[1].toLowerCase()} ${stage[2]}` }
    : { key: 'PROJECT', label: 'project' };
}

function factsFromProse(text: string, location: string): Fact[] {
  const quote = clip(text);
  const facts: Fact[] = [];
  const push = (subject: { key: string; label: string }, found: Found) =>
    facts.push({
      subjectKey: subject.key,
      subjectLabel: subject.label,
      attribute: found.attribute,
      value: found.value,
      unit: found.unit,
      raw: found.raw,
      location,
      quote,
      source: 'pattern',
    });

  const self = selfIdentifying(text);
  // Spans that are themselves classes or standards ("REI-60", "EN-1992") are not IDs.
  const ids = findIds(text);
  const subjects = [...ids, ...findItems(text)].sort((a, b) => a.index - b.index);

  if (subjects.length) {
    for (const found of self) {
      const subject = owner(subjects, found.index);
      if (subject) push(subject, found);
    }
    for (const found of quantities(text)) {
      const subject = owner(subjects, found.index);
      if (subject?.kind === 'item') push(subject, found);
    }
    for (const found of money(text)) {
      const subject = owner(subjects, found.index);
      if (subject?.kind === 'item') push(subject, { attribute: 'amount', value: round(found.value), unit: 'DKK', raw: found.raw, index: found.index });
    }
    for (const id of ids) {
      const revision = REVISION_AFTER_ID.exec(text.slice(id.index + id.label.length));
      if (revision) push(id, { attribute: 'revision', value: revision[1].toUpperCase(), raw: `${id.label}${revision[0]}`, index: id.index });
    }
  } else {
    const elements = findElements(text);
    const structural = self.filter((found) => ['concrete_class', 'exposure_class', 'u_value'].includes(found.attribute));
    const distinctElements = new Set(elements.map((element) => element.key));
    const distinctValues = new Set(structural.map((found) => `${found.attribute}=${found.value}`));
    if (elements.length && !(distinctElements.size > 1 && distinctValues.size > 1)) {
      for (const found of structural) {
        const subject = owner(elements, found.index);
        if (subject) push(subject, found);
      }
    }
  }

  const project = projectSubject(text);
  for (const found of milestoneDates(text)) push(project, found);
  if (CONTRACT_SUM.test(text)) {
    for (const found of money(text).slice(0, 1)) {
      push(project, { attribute: 'contract_sum', value: round(found.value), unit: 'DKK', raw: found.raw, index: found.index });
    }
  }
  for (const found of standards(text)) {
    const [key, attribute] = found.attribute.split('|');
    push({ key, label: standardLabel(found.raw) }, { ...found, attribute });
  }
  return facts;
}

const LABEL_ATTRIBUTES: [RegExp, string][] = [
  [/brand|fire/i, 'fire_class'],
  [/u-?værdi|u-?vaerdi|u-?value/i, 'u_value'],
  [/trinlyd|impact/i, 'impact_sound'],
  [/lyd|sound|\bdb\b/i, 'sound_insulation'],
  [/bredde|width/i, 'width'],
  [/højde|hoejde|height/i, 'height'],
  [/tykkelse|thickness/i, 'thickness'],
  [/længde|laengde|length/i, 'length'],
  [/mængde|maengde|antal|qty|quantity|kvantum|mgd/i, 'quantity'],
  [/enhedspris|unit ?price|á-?pris|a-?pris/i, 'unit_price'],
  [/beløb|beloeb|sum|total|amount|pris|price/i, 'amount'],
  [/^rev/i, 'revision'],
];
const UNIT_LABEL = /^(enhed|enh|unit|måleenhed)\b/i;
const ITEM_LABEL = /^(pos|post|item|nr|no\b|varenr|bygningsdelsnr)/i;
const DESCRIPTION_LABEL = /tekst|beskrivelse|description|betegnelse|navn|name/i;

function labelUnit(label: string): string | null {
  return /[([]\s*(mm|cm|m)\s*[)\]]/i.exec(label)?.[1].toLowerCase() ?? null;
}

function factsFromRow(segment: Segment): Fact[] {
  const cells = segment.cells ?? [];
  const quote = clip(segment.text);
  let subject: { key: string; label: string } | null = null;
  let subjectCell = -1;

  cells.forEach((cell, index) => {
    if (subject) return;
    const value = cell.value.trim();
    if ((ITEM_LABEL.test(cell.label) || index === 0) && ITEM_NUMBER.test(value)) {
      subject = { key: `ITEM:${value}`, label: `item ${value}` };
      subjectCell = index;
      return;
    }
    const ids = findIds(value);
    if (ids.length && ids[0].index === 0 && ids[0].label.length >= value.length - 2) {
      subject = { key: ids[0].key, label: ids[0].label };
      subjectCell = index;
    }
  });

  const facts: Fact[] = [];
  const unitCell = cells.find((cell) => UNIT_LABEL.test(cell.label));
  const description = cells.find((cell, index) => index !== subjectCell && DESCRIPTION_LABEL.test(cell.label));

  if (subject) {
    const owner = subject as { key: string; label: string };
    const label = description ? `${owner.label} (${clip(description.value).slice(0, 60)})` : owner.label;
    const push = (found: Omit<Found, 'index'>) =>
      facts.push({ subjectKey: owner.key, subjectLabel: label, ...found, location: segment.location, quote, source: 'pattern' });

    cells.forEach((cell, index) => {
      if (index === subjectCell) return;
      const attribute = LABEL_ATTRIBUTES.find(([pattern]) => pattern.test(cell.label))?.[1];
      const value = cell.value.trim();
      const self = selfIdentifying(value);
      if (attribute === 'fire_class' || !attribute) {
        for (const found of self) push(found);
        return;
      }
      if (attribute === 'revision') {
        if (/^[A-Z0-9]{1,3}$/i.test(value)) push({ attribute, value: value.toUpperCase(), raw: value });
        return;
      }
      const numeric = /^([-+]?\d[\d.,\s]*)\s*([a-zA-Z²³.]*)$/.exec(value);
      const number = numeric ? parseNumber(numeric[1]) : null;
      if (number === null) {
        for (const found of self) push(found);
        return;
      }
      const inlineUnit = numeric?.[2] ?? '';
      if (['width', 'height', 'thickness', 'length'].includes(attribute)) {
        const unit = labelUnit(cell.label) ?? (inlineUnit ? inlineUnit.toLowerCase() : Number.isInteger(number) && number >= 10 ? 'mm' : null);
        const mm = unit ? lengthToMm(number, unit) : null;
        if (mm !== null) push({ attribute, value: round(mm), unit: 'mm', raw: value });
      } else if (attribute === 'quantity') {
        const unit = inlineUnit || unitCell?.value || '';
        push({ attribute, value: round(number), unit: unit ? normalizeUnit(unit) : undefined, raw: value });
      } else if (attribute === 'amount' || attribute === 'unit_price') {
        push({ attribute, value: round(number), unit: 'DKK', raw: value });
      } else if (attribute === 'u_value') {
        push({ attribute, value: round(number), unit: 'W/m2K', raw: value });
      } else {
        push({ attribute, value: round(number), unit: 'dB', raw: value });
      }
    });
  }

  const project = projectSubject(segment.text);
  for (const found of milestoneDates(segment.text, cells)) {
    facts.push({ subjectKey: project.key, subjectLabel: project.label, ...found, location: segment.location, quote, source: 'pattern' });
  }
  for (const found of standards(segment.text)) {
    const [key, attribute] = found.attribute.split('|');
    facts.push({ subjectKey: key, subjectLabel: standardLabel(found.raw), attribute, value: found.value, raw: found.raw, location: segment.location, quote, source: 'pattern' });
  }
  return facts;
}

const SENTENCE_BREAK = /(?<=[.!?;])\s+(?=[A-ZÆØÅ][a-zæøå])/;

/** Split a chunk into rows (spreadsheet/table) and sentences (prose), each with its own location. */
export function segmentsOf(chunk: TextChunk): Segment[] {
  const segments: Segment[] = [];
  let header: string[] | null = null;
  for (const line of chunk.text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('[Sheet:') || trimmed.startsWith('Columns:')) continue;

    const row = /^Row (\d+): (.*)$/.exec(trimmed);
    if (row) {
      const cells = row[2].split(' | ').map((cell) => {
        const at = cell.indexOf('=');
        return at > 0 ? { label: cell.slice(0, at), value: cell.slice(at + 1) } : { label: '', value: cell };
      });
      const location = /rows \d+/.test(chunk.location) ? chunk.location.replace(/rows .*$/, `row ${row[1]}`) : `${chunk.location}, row ${row[1]}`;
      segments.push({ text: cells.map((cell) => cell.value).join(' | '), location, cells });
      continue;
    }

    if (trimmed.includes(' | ')) {
      const values = trimmed.split(' | ').map((cell) => cell.trim());
      if (values.every((value) => !/\d/.test(value))) {
        header = values;
        continue;
      }
      segments.push({
        text: values.join(' | '),
        location: chunk.location,
        cells: values.map((value, index) => ({ label: header?.[index] ?? '', value })),
      });
      continue;
    }

    header = null;
    for (const sentence of trimmed.split(SENTENCE_BREAK)) {
      if (sentence.trim()) segments.push({ text: sentence.trim(), location: chunk.location });
    }
  }
  return segments;
}

export function extractFacts(chunks: readonly TextChunk[]): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const segment of segmentsOf(chunk)) {
      for (const fact of segment.cells ? factsFromRow(segment) : factsFromProse(segment.text, segment.location)) {
        // Chunks overlap, so the same statement is often seen twice.
        const key = `${fact.subjectKey}\u0000${fact.attribute}\u0000${fact.value}\u0000${fact.unit ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(fact);
      }
    }
  }
  return facts;
}
