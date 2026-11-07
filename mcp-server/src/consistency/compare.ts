/**
 * Cross-document comparison: facts about the same subject and attribute from
 * different files are clustered by canonical value; more than one cluster
 * spanning more than one file is a candidate inconsistency.
 */

import { createHash } from 'node:crypto';
import { datesAgree } from './normalize';
import type { Fact } from './facts';

export type FindingType =
  | 'value_conflict'
  | 'quantity_conflict'
  | 'date_conflict'
  | 'reference_conflict'
  | 'revision_conflict'
  | 'other';
export type Severity = 'high' | 'medium' | 'low';
export type Verdict = 'confirmed' | 'candidate';

export interface Statement {
  fileId: string;
  fileName: string;
  revisionId?: string;
  location: string;
  quote: string;
  value?: string;
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  subject: string;
  attribute: string;
  summary: string;
  verdict: Verdict;
  explanation?: string;
  precedenceNote?: string;
  statements: Statement[];
}

export interface FileFacts {
  fileId: string;
  fileName: string;
  revisionId?: string;
  facts: Fact[];
}

export const FOCUS_AREAS = [
  'fire',
  'structural',
  'thermal',
  'acoustic',
  'dimensions',
  'quantities',
  'money',
  'dates',
  'standards',
  'drawings',
  'other',
] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];

const DIMENSIONS = ['width', 'height', 'thickness', 'length', 'depth', 'diameter'];
const MONEY = ['amount', 'unit_price', 'contract_sum'];

export function isDateAttribute(attribute: string): boolean {
  return attribute.endsWith('_date') || attribute === 'tender_deadline' || attribute === 'date';
}

export function focusOf(attribute: string): FocusArea {
  if (attribute === 'fire_class') return 'fire';
  if (attribute === 'concrete_class' || attribute === 'exposure_class') return 'structural';
  if (attribute === 'u_value') return 'thermal';
  if (attribute === 'sound_insulation' || attribute === 'impact_sound') return 'acoustic';
  if (DIMENSIONS.includes(attribute)) return 'dimensions';
  if (attribute === 'quantity') return 'quantities';
  if (MONEY.includes(attribute)) return 'money';
  if (isDateAttribute(attribute)) return 'dates';
  if (attribute === 'edition' || attribute === 'national_annex') return 'standards';
  if (attribute === 'revision') return 'drawings';
  return 'other';
}

function typeOf(attribute: string): FindingType {
  switch (focusOf(attribute)) {
    case 'quantities':
    case 'money':
      return 'quantity_conflict';
    case 'dates':
      return 'date_conflict';
    case 'standards':
      return 'reference_conflict';
    case 'drawings':
      return 'revision_conflict';
    case 'other':
      return 'other';
    default:
      return 'value_conflict';
  }
}

/** Fire, structural, deadline and money conflicts are the ones that cost a project most. */
function severityOf(attribute: string, subjectKey: string): Severity {
  const focus = focusOf(attribute);
  if (['fire', 'structural', 'money', 'dates'].includes(focus)) return 'high';
  // Eurocodes (DS/EN 1990–1999) carry the structural design basis.
  if (focus === 'standards') return /^STD:199\d\b/.test(subjectKey) ? 'high' : 'medium';
  if (focus === 'other') return 'low';
  return 'medium';
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    Number(b.verdict === 'confirmed') - Number(a.verdict === 'confirmed') ||
    a.subject.localeCompare(b.subject) ||
    a.attribute.localeCompare(b.attribute)
  );
}

export function valuesAgree(attribute: string, a: string, b: string): boolean {
  if (isDateAttribute(attribute)) return datesAgree(a, b);
  const x = Number(a);
  const y = Number(b);
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) {
    return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

function display(fact: Fact): string {
  return fact.unit ? `${fact.value} ${fact.unit}` : fact.value;
}

interface Located {
  file: FileFacts;
  fact: Fact;
}

/** Build every candidate finding across `files`, optionally restricted to some focus areas. */
export function findInconsistencies(files: readonly FileFacts[], focus?: readonly FocusArea[]): Finding[] {
  const groups = new Map<string, Located[]>();
  for (const file of files) {
    for (const fact of file.facts) {
      if (focus?.length && !focus.includes(focusOf(fact.attribute))) continue;
      // Quantities in different units (m2 vs m3 of the same item) measure different things.
      const unit = fact.attribute === 'quantity' ? fact.unit ?? '' : '';
      const key = `${fact.subjectKey}\u0000${fact.attribute}\u0000${unit}`;
      groups.set(key, [...(groups.get(key) ?? []), { file, fact }]);
    }
  }

  const findings: Finding[] = [];
  for (const [key, members] of groups) {
    if (new Set(members.map((member) => member.file.fileId)).size < 2) continue;
    const { attribute, subjectKey } = members[0].fact;

    const clusters: Located[][] = [];
    for (const member of members) {
      const cluster = clusters.find((existing) => valuesAgree(attribute, existing[0].fact.value, member.fact.value));
      if (cluster) cluster.push(member);
      else clusters.push([member]);
    }
    if (clusters.length < 2) continue;

    // One statement per (file, value): repeating the same claim from one file adds nothing.
    const statements: Statement[] = [];
    for (const cluster of clusters) {
      const perFile = new Map<string, Located>();
      for (const member of cluster) {
        if (!perFile.has(member.file.fileId)) perFile.set(member.file.fileId, member);
      }
      for (const { file, fact } of perFile.values()) {
        statements.push({
          fileId: file.fileId,
          fileName: file.fileName,
          revisionId: file.revisionId,
          location: fact.location,
          quote: fact.quote,
          value: display(fact),
        });
      }
    }
    // A disagreement that exists only inside one file is that file's problem, not a cross-document one.
    const conflictingAcrossFiles = clusters.some((cluster, i) =>
      clusters.some((other, j) => j > i && cluster.some((a) => other.some((b) => a.file.fileId !== b.file.fileId))),
    );
    if (!conflictingAcrossFiles) continue;

    const subject = members.find((member) => member.fact.subjectLabel.length > members[0].fact.subjectLabel.length)?.fact.subjectLabel
      ?? members[0].fact.subjectLabel;
    const summary = `${subject} — ${attribute.replace(/_/g, ' ')}: ${clusters
      .map((cluster) => `${display(cluster[0].fact)} (${[...new Set(cluster.map((m) => m.file.fileName))].join(', ')})`)
      .join(' vs ')}`;
    const id = createHash('sha256')
      .update(key)
      .update(statements.map((s) => `${s.fileId}:${s.revisionId ?? ''}:${s.value}`).sort().join('|'))
      .digest('hex')
      .slice(0, 12);

    findings.push({
      id,
      type: typeOf(attribute),
      severity: severityOf(attribute, subjectKey),
      subject,
      attribute,
      summary,
      verdict: 'candidate',
      statements,
    });
  }
  return findings.sort(compareFindings);
}
