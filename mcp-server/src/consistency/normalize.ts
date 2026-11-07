/**
 * Value normalization for cross-document comparison: the same requirement
 * written as "EI 60" / "EI60", "1.200 mm" / "1,2 m" or "01-03-2027" /
 * "1. marts 2027" must compare equal, so every extracted value is reduced to
 * one canonical form before facts are grouped.
 */

/**
 * Parse a number written the Danish way ("1.234,5", "12,5") or the English way
 * ("1,234.5", "12.5"). With only dots, a dot followed by exactly three digits
 * is a thousands separator ("1.200"); a lone comma is always a decimal comma,
 * since that is what Danish documents mean by it.
 */
export function parseNumber(raw: string): number | null {
  let text = raw.replace(/[\s\u00a0]/g, '').replace(/^\+/, '').replace(/^[−–]/, '-');
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    text = /^-?\d{1,3}(,\d{3}){2,}$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
    if ((text.match(/,/g) ?? []).length) return null;
  } else if (lastDot >= 0) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
    else if ((text.match(/\./g) ?? []).length > 1) return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const LENGTH_TO_MM: Record<string, number> = { mm: 1, cm: 10, dm: 100, m: 1000 };

export function lengthToMm(value: number, unit: string): number | null {
  const factor = LENGTH_TO_MM[unit.toLowerCase()];
  return factor === undefined ? null : value * factor;
}

/** Canonical quantity unit: "m²" -> "m2", "stk." -> "stk", "pcs" -> "stk". */
export function normalizeUnit(raw: string): string {
  const unit = raw.trim().toLowerCase().replace(/\.$/, '').replace('²', '2').replace('³', '3');
  if (['stk', 'st', 'pcs', 'pc', 'nos', 'no', 'ea', 'each'].includes(unit)) return 'stk';
  if (['lbm', 'lb.m', 'lm', 'm1'].includes(unit)) return 'm';
  if (unit === 'kvm') return 'm2';
  if (['ton', 'tons'].includes(unit)) return 't';
  return unit;
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, marts: 3, march: 3,
  apr: 4, april: 4,
  maj: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Matches the date forms normalizeDate understands, for scanning prose. */
export const DATE_PATTERN = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}[-./]\d{1,2}[-./]\d{4}\b`,
    String.raw`\b\d{1,2}\.?\s+(?:${MONTH_NAMES})\.?\s+\d{4}\b`,
    String.raw`\b(?:${MONTH_NAMES})\.?\s+\d{1,2},?\s+\d{4}\b`,
    String.raw`\b(?:uge|week|wk|uke)\.?\s*\d{1,2}(?:\s*[,/-]\s*|\s+)\d{4}\b`,
  ].join('|'),
  'gi',
);

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * "2027-03-01", "01-03-2027", "1/3/2027" and "1. marts 2027" all become
 * "2027-03-01"; "uge 12 2027" becomes the ISO week "2027-W12". Numeric
 * dates are read day-first, as Danish documents write them.
 */
export function normalizeDate(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return iso(+match[1], +match[2], +match[3]);
  match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(text);
  if (match) return iso(+match[3], +match[2], +match[1]);
  match = new RegExp(String.raw`^(\d{1,2})\.?\s+(${MONTH_NAMES})\.?\s+(\d{4})$`).exec(text);
  if (match) return iso(+match[3], MONTHS[match[2]], +match[1]);
  match = new RegExp(String.raw`^(${MONTH_NAMES})\.?\s+(\d{1,2}),?\s+(\d{4})$`).exec(text);
  if (match) return iso(+match[3], MONTHS[match[1]], +match[2]);
  match = /^(?:uge|week|wk|uke)\.?\s*(\d{1,2})(?:\s*[,/-]\s*|\s+)(\d{4})$/.exec(text);
  if (match && +match[1] >= 1 && +match[1] <= 53) return `${match[2]}-W${match[1].padStart(2, '0')}`;
  return null;
}

/** ISO week ("2027-W12") containing an ISO date. */
export function isoWeekOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** A date and a week are the same statement when the date falls inside that week. */
export function datesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const aWeek = a.includes('W') ? a : isoWeekOf(a);
  const bWeek = b.includes('W') ? b : isoWeekOf(b);
  return (a.includes('W') || b.includes('W')) && aWeek === bWeek;
}

/** "D-101", "d 101" and "D101" are the same door; the key drops separators and case. */
export function normalizeId(raw: string): string {
  return raw.toUpperCase().replace(/[\s_.\-/]/g, '');
}
