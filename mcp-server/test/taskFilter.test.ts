import { translateTaskFilter } from '../src/taskFilter';

describe('translateTaskFilter', () => {
  it.each([
    ["data/type/typeId eq 'S1'", "data/type/typeId eq 'S1'", []],
    ["  ( data/type/typeId   eq  \"S1\" ) ", "data/type/typeId eq 'S1'", []],
    ["type/typeId eq 'it''s'", "data/type/typeId eq 'it''s'", []],
    ["data/workflow/name eq 'Open'", undefined, [{ field: 'workflow.name', op: 'eq', value: 'Open' }]],
    ["workflow/name ne 'Closed'", undefined, [{ field: 'workflow.name', op: 'ne', value: 'Closed' }]],
    [
      "data/created ge 2026-08-01T00:00:00Z and created lt '2026-09-01'",
      undefined,
      [
        { field: 'created', op: 'ge', value: '2026-08-01T00:00:00Z' },
        { field: 'created', op: 'lt', value: '2026-09-01' },
      ],
    ],
    ['priority GT 2 and (done eq false)', undefined, [
      { field: 'priority', op: 'gt', value: 2 },
      { field: 'done', op: 'eq', value: false },
    ]],
    ["contains(data/subject,'crack') and startswith(number, 'SIOB')", undefined, [
      { field: 'subject', op: 'contains', value: 'crack' },
      { field: 'number', op: 'startswith', value: 'SIOB' },
    ]],
    ["data/type/typeId eq 'S1' and data/usage eq 'Task'", "data/type/typeId eq 'S1'", [{ field: 'usage', op: 'eq', value: 'Task' }]],
    ["data/type/typeId ne 'S1'", undefined, [{ field: 'type.typeId', op: 'ne', value: 'S1' }]],
  ])('%s', (filter, odataFilter, conditions) => {
    const result = translateTaskFilter(filter);
    expect(result.odataFilter).toBe(odataFilter);
    expect(result.conditions).toEqual(conditions);
    expect(Boolean(result.note)).toBe(conditions.length > 0);
  });

  it.each([
    ["workflow/name eq 'Open' or workflow/name eq 'New'", /or\/not/],
    ["not contains(subject,'x')", /or\/not/],
    ["substringof('x', subject)", /not a simple comparison/],
    ['created ge now()', /unsupported value `now\(\)`/],
    ["subject eq 'unterminated", /unbalanced/],
  ])('rejects %s', (filter, reason) => {
    expect(() => translateTaskFilter(filter)).toThrow(reason);
  });

  it('shows the translatable part as conditions when rejecting', () => {
    expect(() => translateTaskFilter("usage eq 'Task' and (a eq 1 or b eq 2)")).toThrow(
      'conditions: [{"field":"usage","op":"eq","value":"Task"}]',
    );
  });
});
