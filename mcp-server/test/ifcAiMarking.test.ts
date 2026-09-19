import {
  applyValuePrefix,
  provenanceForDeleteProperty,
  provenanceForDeletePset,
  provenanceForSet,
  resolvePsetTarget,
  AI_PSET_PREFIX,
} from '../src/ifc/aiMarking';

const AT = new Date('2026-09-18T10:22:00.000Z');

describe('resolvePsetTarget', () => {
  it('prefixes a pset the element does not already carry', () => {
    expect(resolvePsetTarget(['Pset_WallCommon'], 'Pset_Thermal')).toEqual({
      pset: 'AI_Pset_Thermal',
      marking: 'prefixed',
      renamedFrom: 'Pset_Thermal',
    });
  });

  it('edits in place when the element already carries the pset', () => {
    // A shadow AI_Pset_WallCommon would leave the file stating two FireRatings
    // with nothing to say which is current — the provenance pset records the
    // change instead.
    expect(resolvePsetTarget(['Pset_WallCommon'], 'Pset_WallCommon')).toEqual({
      pset: 'Pset_WallCommon',
      marking: 'in-place',
    });
  });

  it('does not double-prefix a name the caller already prefixed', () => {
    expect(resolvePsetTarget([], `${AI_PSET_PREFIX}Review`)).toEqual({
      pset: 'AI_Review',
      marking: 'prefixed',
    });
  });
});

describe('applyValuePrefix', () => {
  it('prefixes a string', () => {
    expect(applyValuePrefix('REI 120')).toEqual({ value: 'AI: REI 120', prefixed: true });
  });

  it('is idempotent', () => {
    expect(applyValuePrefix('AI: REI 120')).toEqual({ value: 'AI: REI 120', prefixed: true });
  });

  it.each([
    [0.18, 'number'],
    [true, 'boolean'],
  ])('refuses %p rather than turning it into a label', (value, kind) => {
    // "AI: 0.18" is a string, and ifc_schedule would then drop it from every
    // total — marking data must not corrupt the data it marks.
    const result = applyValuePrefix(value);
    expect(result.value).toBe(value);
    expect(result.prefixed).toBe(false);
    expect(result.skipped).toContain(kind);
  });
});

describe('provenance records', () => {
  it('names the old value on an overwrite', () => {
    expect(provenanceForSet('Pset_WallCommon', 'FireRating', 'REI 120', 'REI 60', AT)).toEqual({
      name: 'Pset_WallCommon.FireRating',
      value: 'AI set "REI 120" (was "REI 60") 2026-09-18T10:22:00.000Z',
    });
  });

  it('says "created" when there was no prior value', () => {
    expect(provenanceForSet('AI_Review', 'Score', 0.18, undefined, AT).value).toBe(
      'AI created 0.18 2026-09-18T10:22:00.000Z',
    );
  });

  it('distinguishes an absent prior value from a null one', () => {
    expect(provenanceForSet('P', 'X', 1, null, AT).value).toContain('(was (null))');
    expect(provenanceForSet('P', 'X', 1, undefined, AT).value).not.toContain('was');
  });

  it('keeps the deleted value in the record', () => {
    expect(provenanceForDeleteProperty('Pset_WallCommon', 'FireRating', 'REI 60', AT).value).toBe(
      'AI deleted property (was "REI 60") 2026-09-18T10:22:00.000Z',
    );
  });

  it('names the properties a deleted pset held, since nothing else will', () => {
    const entry = provenanceForDeletePset('Pset_QuantityTakeOff', ['Reference', 'Length'], AT);
    expect(entry.name).toBe('Pset_QuantityTakeOff');
    expect(entry.value).toBe('AI deleted property set — 2 properties: Reference, Length 2026-09-18T10:22:00.000Z');
  });

  it('keeps the singular readable for a one-property set', () => {
    expect(provenanceForDeletePset('P', ['Reference'], AT).value).toContain('1 property: Reference');
  });
});
