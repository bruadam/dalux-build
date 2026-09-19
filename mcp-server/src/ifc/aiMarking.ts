/**
 * The rule that makes every AI-written value in an exported IFC identifiable
 * as AI-written, by someone opening the file in a viewer that knows nothing
 * about this server.
 *
 * Two mechanisms, applied together and not optional:
 *
 *   1. A property set this server *creates* is named with the `AI_` prefix,
 *      so an unprefixed pset in the file is always one the original authoring
 *      tool wrote.
 *   2. Every change — including an edit to an existing, unprefixed pset — is
 *      recorded on the same element in an `AI_Provenance` pset, one property
 *      per changed path, carrying the old value, the new value and when.
 *
 * Why not prefix the *values* instead, which is the version that shows up
 * most obviously in a viewer: `Pset_Thermal.UValue = "AI: 0.18"` turns a real
 * into a label, and this server's own `ifc_schedule` and `ifc_property_values`
 * then read it as a string and silently drop it from any total. Marking data
 * must not corrupt the data it marks. Value prefixing is still available as an
 * opt-in, and is refused on anything that is not already a string — see
 * `applyValuePrefix`.
 *
 * Why edits to an existing pset stay in that pset rather than being shadowed
 * into an `AI_`-prefixed copy: a shadow leaves the file stating two different
 * values for one property path with nothing to say which one is current. The
 * provenance pset records the same fact without making the model ambiguous.
 */

/** Prefix on every property set this server creates. */
export const AI_PSET_PREFIX = 'AI_';

/** Pset carrying the audit trail. Prefixed too, so the rule above holds for it. */
export const PROVENANCE_PSET = 'AI_Provenance';

/** Opt-in prefix for string values (see `applyValuePrefix`). */
export const AI_VALUE_PREFIX = 'AI: ';

/** Properties of PROVENANCE_PSET that are not one changed path. */
export const PROVENANCE_TOOL_PROPERTY = 'ModifiedBy';
export const PROVENANCE_TIME_PROPERTY = 'ModifiedAt';

export type PropertyValue = string | number | boolean | null;

export interface PsetTarget {
  /** The pset name to actually write to. */
  pset: string;
  /** How that name was arrived at, for the caller's report. */
  marking: 'prefixed' | 'in-place';
  /** Set when `pset` differs from what the caller asked for. */
  renamedFrom?: string;
}

/**
 * Decide which pset a write lands in.
 *
 * `existing` is the set of pset names the element already carries (mutations
 * applied) — an edit to one of those is an edit, anything else is a creation
 * and gets the prefix.
 */
export function resolvePsetTarget(existing: Iterable<string>, requested: string): PsetTarget {
  const names = existing instanceof Set ? existing : new Set(existing);
  if (requested.startsWith(AI_PSET_PREFIX)) return { pset: requested, marking: 'prefixed' };
  if (names.has(requested)) return { pset: requested, marking: 'in-place' };
  return { pset: AI_PSET_PREFIX + requested, marking: 'prefixed', renamedFrom: requested };
}

/**
 * Prefix a string value, or refuse.
 *
 * A number or boolean is returned unchanged with a `skipped` reason rather
 * than coerced: `0.18` becoming `"AI: 0.18"` is exactly the corruption this
 * module's header rejects, and doing it quietly because the caller passed a
 * flag would be worse than doing it loudly.
 */
export function applyValuePrefix(value: PropertyValue): { value: PropertyValue; prefixed: boolean; skipped?: string } {
  if (typeof value !== 'string') {
    return { value, prefixed: false, skipped: `value is a ${value === null ? 'null' : typeof value}; prefixing it would change its IFC type` };
  }
  if (value.startsWith(AI_VALUE_PREFIX)) return { value, prefixed: true };
  return { value: AI_VALUE_PREFIX + value, prefixed: true };
}

function render(value: PropertyValue | undefined): string {
  if (value === undefined) return '(absent)';
  if (value === null) return '(null)';
  return typeof value === 'string' ? `"${value}"` : String(value);
}

export interface ProvenanceEntry {
  /** Property name inside PROVENANCE_PSET — the path that changed. */
  name: string;
  /** Human-readable record of the change. */
  value: string;
}

/** `Pset.Property` was set to `newValue` (from `oldValue`, if it had one). */
export function provenanceForSet(
  pset: string,
  property: string,
  newValue: PropertyValue,
  oldValue: PropertyValue | undefined,
  at: Date,
): ProvenanceEntry {
  const verb = oldValue === undefined ? 'created' : 'set';
  const was = oldValue === undefined ? '' : ` (was ${render(oldValue)})`;
  return {
    name: `${pset}.${property}`,
    value: `AI ${verb} ${render(newValue)}${was} ${at.toISOString()}`,
  };
}

/** `Pset.Property` was removed. */
export function provenanceForDeleteProperty(
  pset: string,
  property: string,
  oldValue: PropertyValue | undefined,
  at: Date,
): ProvenanceEntry {
  return {
    name: `${pset}.${property}`,
    value: `AI deleted property (was ${render(oldValue)}) ${at.toISOString()}`,
  };
}

/** A whole pset was removed, with the properties it held named so the record survives the data. */
export function provenanceForDeletePset(pset: string, removed: string[], at: Date): ProvenanceEntry {
  const listed = removed.length > 0 ? `: ${removed.join(', ')}` : '';
  return {
    name: pset,
    value: `AI deleted property set — ${removed.length} propert${removed.length === 1 ? 'y' : 'ies'}${listed} ${at.toISOString()}`,
  };
}

/** A top-level IFC attribute (Name, Description, ObjectType, Tag) was changed. */
export function provenanceForAttribute(
  attribute: string,
  newValue: string,
  oldValue: PropertyValue | undefined,
  at: Date,
): ProvenanceEntry {
  return {
    name: `Attribute.${attribute}`,
    value: `AI set ${render(newValue)} (was ${render(oldValue)}) ${at.toISOString()}`,
  };
}
