/**
 * Persistent catalog of named clash rules.
 *
 * Seeded (never written to disk, just merged in on read) with ifc-lite's
 * built-in discipline-matrix presets — MEPxSTR, HVACxSTR, HVACxARCH, ... —
 * so the catalog is never empty. Custom rules saved via saveRule are kept in
 * a single JSON file (see cachePaths.clashRulesPath) and upserted by id, so a
 * team's rule library grows call by call rather than being overwritten
 * wholesale on every save.
 *
 * A custom rule may reuse a built-in's id to override it (e.g. narrower
 * tolerance for "MEPxSTR"); built-ins themselves can't be deleted, only
 * shadowed, so a fresh catalog always has a sane starting point.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { clashRulesPath } from '../cachePaths';
import { loadIfcClash } from './runtime';

export type ClashRuleMode = 'hard' | 'clearance';
export type ClashRuleSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface CatalogRule {
  id: string;
  name: string;
  description?: string;
  /** Type selector for set A, e.g. "IfcDuct*|IfcPipe*". */
  a: string;
  /** Type selector for set B. Omitted ⇒ self-clash within A. */
  b?: string;
  mode: ClashRuleMode;
  tolerance?: number;
  clearance?: number;
  severity?: ClashRuleSeverity;
  reportTouch?: boolean;
  source: 'builtin' | 'custom';
}

interface CatalogFile {
  custom: CatalogRule[];
}

async function builtinRules(): Promise<CatalogRule[]> {
  const ifc = await loadIfcClash();
  return ifc.CLASH_RULE_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    a: p.selectorA,
    b: p.selectorB,
    mode: 'hard' as const,
    severity: p.severity,
    source: 'builtin' as const,
  }));
}

function readCustom(): CatalogRule[] {
  const filePath = clashRulesPath();
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as CatalogFile;
    return Array.isArray(parsed.custom) ? parsed.custom : [];
  } catch {
    // A hand-edited or half-written file reads as an empty custom catalog
    // rather than a crash — the built-ins alone are still a usable starting set.
    return [];
  }
}

function writeCustom(rules: CatalogRule[]): void {
  writeFileSync(clashRulesPath(), JSON.stringify({ custom: rules }, null, 2), 'utf-8');
}

/** Built-ins plus custom rules, custom taking precedence on a shared id. */
export async function listRules(): Promise<CatalogRule[]> {
  const builtins = await builtinRules();
  const custom = readCustom();
  const overridden = new Set(custom.map((r) => r.id));
  return [...builtins.filter((b) => !overridden.has(b.id)), ...custom];
}

export async function getRules(ids: string[]): Promise<CatalogRule[]> {
  const all = await listRules();
  const byId = new Map(all.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const available = all.map((r) => r.id).join(', ');
    throw new Error(`Unknown clash rule id(s): ${missing.join(', ')}. Available: ${available}`);
  }
  return ids.map((id) => byId.get(id)!);
}

export interface SaveRuleInput {
  id?: string;
  name: string;
  description?: string;
  a: string;
  b?: string;
  mode?: ClashRuleMode;
  tolerance?: number;
  clearance?: number;
  severity?: ClashRuleSeverity;
  reportTouch?: boolean;
}

function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `rule-${Date.now()}`;
}

/** Create or update (by id) a custom rule. Returns the saved rule. */
export function saveRule(input: SaveRuleInput): CatalogRule {
  const custom = readCustom();
  const id = input.id ?? slugify(input.name);
  const rule: CatalogRule = {
    id,
    name: input.name,
    description: input.description,
    a: input.a,
    b: input.b,
    mode: input.mode ?? 'hard',
    tolerance: input.tolerance,
    clearance: input.clearance,
    severity: input.severity,
    reportTouch: input.reportTouch,
    source: 'custom',
  };
  const idx = custom.findIndex((r) => r.id === id);
  if (idx >= 0) custom[idx] = rule;
  else custom.push(rule);
  writeCustom(custom);
  return rule;
}

/** Delete a custom rule by id. Returns false if no custom rule has that id (built-ins can't be deleted). */
export function deleteRule(id: string): boolean {
  const custom = readCustom();
  const idx = custom.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  custom.splice(idx, 1);
  writeCustom(custom);
  return true;
}
