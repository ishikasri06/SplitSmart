import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCloudExpense,
  mapCloudSettlement,
  computeCloudDashboard,
  prepareSettlement,
} from "../src/cloudDashboard.js";

test("mapCloudExpense converts db row into ledger shape", () => {
  const expense = mapCloudExpense({
    id: "e1",
    group_id: "g1",
    title: "Dinner",
    amount: "300.00",
    category: "Food",
    paid_by: "a",
    expense_date: "2026-10-01",
    notes: null,
    split_type: "equal",
    created_at: "2026-10-01T10:00:00.000Z",
    expense_shares: [
      { user_id: "a", share_amount: "100.00" },
      { user_id: "b", share_amount: "200.00" },
    ],
  });

  assert.equal(expense.groupId, "g1");
  assert.equal(expense.amount, 300);
  assert.equal(expense.paidById, "a");
  assert.equal(expense.splitMethod, "equal");
  assert.deepEqual(expense.participantIds, ["a", "b"]);
  assert.deepEqual(expense.shares, { a: 100, b: 200 });
  assert.equal(expense.notes, "");
  assert.equal(typeof expense.createdAt, "number");
});

test("mapCloudSettlement converts db row into fromId/toId shape", () => {
  const settlement = mapCloudSettlement({
    id: "s1",
    group_id: "g1",
    paid_by: "b",
    paid_to: "a",
    amount: "30.00",
    settled_at: "2026-10-02",
  });

  assert.deepEqual(settlement, {
    id: "s1",
    groupId: "g1",
    fromId: "b",
    toId: "a",
    amount: 30,
    date: "2026-10-02",
  });
});

test("computeCloudDashboard totals, average, balances and my net", () => {
  const result = computeCloudDashboard({
    expenses: [
      { paidById: "a", amount: 90, shares: { a: 30, b: 30, c: 30 } },
    ],
    settlements: [{ fromId: "b", toId: "a", amount: 30 }],
    currentUserId: "a",
  });

  assert.equal(result.total, 90);
  assert.equal(result.count, 1);
  assert.equal(result.average, 90);
  assert.equal(result.myNet, 30);
  assert.deepEqual(result.balances, { a: 30, b: 0, c: -30 });
});

test("computeCloudDashboard handles empty input safely", () => {
  const result = computeCloudDashboard({ currentUserId: "a" });

  assert.equal(result.total, 0);
  assert.equal(result.count, 0);
  assert.equal(result.average, 0);
  assert.equal(result.myNet, 0);
  assert.deepEqual(result.balances, {});
});

test("prepareSettlement builds a valid insert payload with the payer's identity", () => {
  const payload = prepareSettlement({
    groupId: "g1",
    currentUserId: "b",
    fromId: "b",
    toId: "a",
    amount: "30.005",
    settledAt: "2026-10-02T00:00:00.000Z",
  });

  assert.deepEqual(payload, {
    group_id: "g1",
    paid_by: "b",
    paid_to: "a",
    amount: 30.01,
    settled_at: "2026-10-02T00:00:00.000Z",
  });
});

test("prepareSettlement defaults settled_at to an ISO timestamp", () => {
  const payload = prepareSettlement({
    groupId: "g1",
    currentUserId: "b",
    fromId: "b",
    toId: "a",
    amount: 12,
  });

  assert.equal(payload.amount, 12);
  assert.equal(typeof payload.settled_at, "string");
  assert.ok(!Number.isNaN(Date.parse(payload.settled_at)));
});

test("prepareSettlement rejects a non-payer", () => {
  assert.throws(
    () =>
      prepareSettlement({
        groupId: "g1",
        currentUserId: "c",
        fromId: "b",
        toId: "a",
        amount: 10,
      }),
    /Only the payer can record this settlement\./
  );
});

test("prepareSettlement rejects self-settlement and bad input", () => {
  const base = { groupId: "g1", currentUserId: "b", fromId: "b", toId: "a", amount: 10 };

  assert.throws(() => prepareSettlement({ ...base, toId: "b" }), /cannot settle with themselves/);
  assert.throws(() => prepareSettlement({ ...base, amount: 0 }), /valid settlement amount/);
  assert.throws(() => prepareSettlement({ ...base, amount: "abc" }), /valid settlement amount/);
  assert.throws(() => prepareSettlement({ ...base, groupId: "" }), /Select a group first/);
  assert.throws(() => prepareSettlement({ ...base, currentUserId: undefined }), /signed in/);
  assert.throws(() => prepareSettlement({ ...base, fromId: "" }), /Choose who pays whom/);
});
