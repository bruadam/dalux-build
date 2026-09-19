import { undoOperations } from '../src/ifc/editEngine';
import type { EditSession } from '../src/ifc/editSession';

/**
 * ifc-lite's `mutation_undo` has no inverse for `DELETE_PROPERTY_SET`, and it
 * discovers that mid-walk — after reverting the newer entries it already
 * passed, and before trimming the history. An unguarded undo across a
 * `delete_pset` therefore leaves the session half-reverted with a history that
 * no longer describes it, which is worse than not undoing at all.
 */
function sessionWith(mutationTypes: string[], ops: EditSession['ops']): EditSession {
  const mutationHistory = mutationTypes.map((type, i) => ({ id: `m${i}`, type }));
  return {
    id: 'edit-1',
    fileName: 'tower.ifc',
    ops,
    model: {
      id: 'edit-1',
      backend: { getMutationView: () => ({ mutationHistory }) },
    },
  } as unknown as EditSession;
}

const op = (n: number, kind: string, mutations: number) => ({
  n,
  kind,
  summary: `${kind} #${n}`,
  elements: 1,
  mutations,
  at: 0,
});

describe('undoOperations', () => {
  it('refuses to undo across a pset deletion, leaving the session untouched', async () => {
    const ops = [op(1, 'set_property', 2), op(2, 'delete_pset', 2)];
    const session = sessionWith(['CREATE_PROPERTY', 'CREATE_PROPERTY', 'DELETE_PROPERTY_SET', 'CREATE_PROPERTY'], ops);

    await expect(undoOperations(session, 1)).rejects.toThrow(/no inverse for a DELETE_PROPERTY_SET/);
    expect(session.ops).toHaveLength(2);
  });

  it('names the operation that blocks it and what to do instead', async () => {
    const session = sessionWith(['DELETE_PROPERTY_SET'], [op(1, 'delete_pset', 1)]);
    await expect(undoOperations(session, 1)).rejects.toThrow(/Nothing was changed/);
    await expect(undoOperations(session, 1)).rejects.toThrow(/discard the\s+session/);
  });

  it('only inspects the mutations the undo would actually span', async () => {
    // The blocking delete is older than the span, so it is not in the way.
    const ops = [op(1, 'delete_pset', 1), op(2, 'set_property', 2)];
    const session = sessionWith(['DELETE_PROPERTY_SET', 'CREATE_PROPERTY', 'CREATE_PROPERTY'], ops);

    // Reaches the ifc-lite call, which this fake session cannot serve — the
    // point is that it got past the guard rather than being refused by it.
    await expect(undoOperations(session, 1)).rejects.not.toThrow(/no inverse/);
  });

  it('is a no-op on a session with nothing queued', async () => {
    const result = await undoOperations(sessionWith([], []), 3);
    expect(result).toEqual({ kind: 'undo', ok: true, summary: 'Nothing to undo.' });
  });
});
