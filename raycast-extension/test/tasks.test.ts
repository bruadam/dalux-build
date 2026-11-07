import assert from "node:assert/strict";
import { test } from "node:test";
import { foldTaskChanges, isClosed, toTaskSummary } from "../src/lib/tasks";

test("toTaskSummary reads the published task fields and unwraps data", () => {
  const task = toTaskSummary({
    data: {
      taskId: "t1",
      number: "SA-12",
      subject: " Crack in wall ",
      type: { name: "Safety" },
      workflow: { name: "Default" },
      createdBy: { userId: "u1" },
      userDefinedFields: { items: [{ name: "Trade", values: [{ text: "Concrete" }] }, { name: "Empty", values: [] }] },
    },
  });
  assert.equal(task?.subject, "Crack in wall");
  assert.equal(task?.typeName, "Safety");
  assert.equal(task?.createdByUserId, "u1");
  assert.deepEqual(task?.userDefinedFields, [{ name: "Trade", value: "Concrete" }]);
});

test("toTaskSummary drops items without a taskId", () => {
  assert.equal(toTaskSummary({ data: { subject: "x" } }), undefined);
});

test("foldTaskChanges keeps the latest state in timestamp order", () => {
  const states = foldTaskChanges([
    {
      taskId: "t1",
      timestamp: "2026-02-01T00:00:00Z",
      action: "update",
      description: "Closing",
      fields: { status: "Closed", modifiedBy: { userId: "u2" } },
    },
    {
      taskId: "t1",
      timestamp: "2026-01-01T00:00:00Z",
      action: "assign",
      fields: { status: "Open", currentResponsible: { userId: "u1" }, workpackageId: "wp1" },
    },
  ]);
  const state = states.t1;
  assert.equal(state.status, "Closed");
  assert.equal(state.responsibleUserId, "u1");
  assert.equal(state.workpackageId, "wp1");
  assert.equal(state.comments[0].text, "Closing");
  assert.ok(isClosed(state));
});
