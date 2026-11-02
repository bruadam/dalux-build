import {
  createUserMapping,
  createCompanyMapping,
  enrichResponseWithUsers,
  enrichUsersWithCompanies,
} from '../src/utils/userMapping';

const FIELD_MAPPINGS = {
  uploadedByUserId: 'uploadedByUser',
  lastModifiedByUserId: 'lastModifiedByUser',
} as const;

describe('createUserMapping', () => {
  it('keys users by userId', () => {
    const user = { userId: 'u1', userType: 'human', email: 'a@example.com' };
    const mapping = createUserMapping([user]);
    expect(mapping.get('u1')).toBe(user);
    expect(mapping.size).toBe(1);
  });

  it('returns an empty map for an empty list', () => {
    expect(createUserMapping([]).size).toBe(0);
  });
});

describe('createCompanyMapping', () => {
  it('keys companies by companyId', () => {
    const company = { companyId: 'c1', name: 'Acme' };
    const mapping = createCompanyMapping([company]);
    expect(mapping.get('c1')).toBe(company);
  });

  it('skips companies with no companyId', () => {
    const mapping = createCompanyMapping([{ companyId: null, name: 'No id' } as any]);
    expect(mapping.size).toBe(0);
  });
});

describe('enrichResponseWithUsers', () => {
  it('adds the mapped object alongside the id field, keeping the id', () => {
    const user = { userId: 'u1', userType: 'human', email: 'a@example.com' };
    const mapping = createUserMapping([user]);
    const result = enrichResponseWithUsers(
      { fileId: 'f1', uploadedByUserId: 'u1' },
      mapping,
      FIELD_MAPPINGS,
    ) as Record<string, unknown>;
    expect(result.uploadedByUserId).toBe('u1');
    expect(result.uploadedByUser).toBe(user);
  });

  it('leaves an id with no match in the mapping untouched, adding nothing', () => {
    const result = enrichResponseWithUsers(
      { fileId: 'f1', uploadedByUserId: 'unknown-user' },
      createUserMapping([]),
      FIELD_MAPPINGS,
    ) as Record<string, unknown>;
    expect(result.uploadedByUserId).toBe('unknown-user');
    expect(result.uploadedByUser).toBeUndefined();
  });

  it('recurses into nested objects and arrays at any depth', () => {
    const user = { userId: 'u1', userType: 'human', email: 'a@example.com' };
    const mapping = createUserMapping([user]);
    const result = enrichResponseWithUsers(
      { items: [{ data: { fileId: 'f1', uploadedByUserId: 'u1' } }] },
      mapping,
      FIELD_MAPPINGS,
    ) as any;
    expect(result.items[0].data.uploadedByUser).toBe(user);
  });

  it('does not mutate its input', () => {
    const input = { fileId: 'f1', uploadedByUserId: 'u1' };
    const frozen = Object.freeze({ ...input });
    const mapping = createUserMapping([{ userId: 'u1', userType: 'human', email: 'a@example.com' }]);
    expect(() => enrichResponseWithUsers(frozen, mapping, FIELD_MAPPINGS)).not.toThrow();
    expect(frozen).toEqual(input);
  });

  it('passes primitives and null through unchanged', () => {
    expect(enrichResponseWithUsers(null, new Map(), FIELD_MAPPINGS)).toBeNull();
    expect(enrichResponseWithUsers('x', new Map(), FIELD_MAPPINGS)).toBe('x');
    expect(enrichResponseWithUsers(42, new Map(), FIELD_MAPPINGS)).toBe(42);
  });
});

describe('enrichUsersWithCompanies', () => {
  it('adds company alongside companyId only on dicts that look like a user (both userId and companyId present)', () => {
    const company = { companyId: 'c1', name: 'Acme' };
    const mapping = createCompanyMapping([company]);
    const user = { userId: 'u1', companyId: 'c1', email: 'a@example.com' };
    const result = enrichUsersWithCompanies(user, mapping) as Record<string, unknown>;
    expect(result.company).toBe(company);
  });

  it('does not treat a companyId-only object (no userId) as a user', () => {
    const company = { companyId: 'c1', name: 'Acme' };
    const mapping = createCompanyMapping([company]);
    const result = enrichUsersWithCompanies({ companyId: 'c1', fileId: 'f1' }, mapping) as Record<
      string,
      unknown
    >;
    expect(result.company).toBeUndefined();
  });

  it('reaches a user nested under a field enrichResponseWithUsers just added', () => {
    const company = { companyId: 'c1', name: 'Acme' };
    const companyMapping = createCompanyMapping([company]);
    const user = { userId: 'u1', userType: 'human', companyId: 'c1', email: 'a@example.com' };
    const userMapping = createUserMapping([user]);

    const afterUsers = enrichResponseWithUsers(
      { fileId: 'f1', uploadedByUserId: 'u1' },
      userMapping,
      FIELD_MAPPINGS,
    );
    const afterCompanies = enrichUsersWithCompanies(afterUsers, companyMapping) as any;
    expect(afterCompanies.uploadedByUser.company).toBe(company);
  });

  it('leaves a companyId with no match in the mapping untouched', () => {
    const user = { userId: 'u1', companyId: 'unknown-company', email: 'a@example.com' };
    const result = enrichUsersWithCompanies(user, createCompanyMapping([])) as Record<string, unknown>;
    expect(result.company).toBeUndefined();
    expect(result.companyId).toBe('unknown-company');
  });
});
