import test from "node:test";
import assert from "node:assert/strict";
import {
  addFrequency,
  billsForGroup,
  bucketRecurringBills,
  buildPaymentShares,
  daysUntil,
  dueLabel,
  isBillDue,
  mapRecurringBill,
  mapRecurringOccurrence,
  occurrencesForBill,
  upcomingRecurringBills,
  validateRecurringConfig,
} from "../src/recurringBills.js";

function makeBill(overrides = {}) {
  return {
    id: "b1",
    groupId: "g1",
    createdBy: "u1",
    title: "Rent",
    amount: 100,
    category: "Rent",
    notes: "",
    frequency: "monthly",
    startDate: "2026-01-31",
    endDate: null,
    nextDueDate: "2026-01-31",
    paidById: "u1",
    splitMethod: "equal",
    participantIds: ["u1", "u2"],
    splitValues: {},
    status: "active",
    createdAt: 0,
    ...overrides,
  };
}

test("addFrequency advances weekly schedules", () => {
  assert.equal(addFrequency("2026-01-01", "weekly"), "2026-01-08");
});

test("addFrequency clamps month ends like Postgres", () => {
  assert.equal(addFrequency("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(addFrequency("2026-03-31", "monthly"), "2026-04-30");
  assert.equal(addFrequency("2026-01-31", "quarterly"), "2026-04-30");
  assert.equal(addFrequency("2026-11-30", "monthly"), "2026-12-30");
  assert.equal(addFrequency("2026-12-15", "monthly"), "2027-01-15");
});

test("addFrequency handles leap years for yearly schedules", () => {
  assert.equal(addFrequency("2024-02-29", "yearly"), "2025-02-28");
  assert.equal(addFrequency("2026-05-20", "yearly"), "2027-05-20");
});

test("addFrequency returns null for unknown frequencies and blank dates", () => {
  assert.equal(addFrequency("2026-01-01", "daily"), null);
  assert.equal(addFrequency("", "monthly"), null);
});

test("daysUntil and isBillDue measure the schedule window", () => {
  assert.equal(daysUntil("2026-01-11", "2026-01-01"), 10);
  assert.equal(daysUntil("2026-01-01", "2026-01-01"), 0);
  assert.equal(daysUntil("2025-12-31", "2026-01-01"), -1);

  assert.equal(isBillDue(makeBill({ nextDueDate: "2026-01-01" }), "2026-01-01"), true);
  assert.equal(isBillDue(makeBill({ nextDueDate: "2026-01-05" }), "2026-01-01"), false);
  assert.equal(
    isBillDue(makeBill({ nextDueDate: "2026-01-01", status: "paused" }), "2026-01-01"),
    false
  );
});

test("dueLabel communicates overdue, today and future dues", () => {
  assert.equal(dueLabel(makeBill({ nextDueDate: "2026-01-30" }), "2026-01-31"), "Overdue by 1 day");
  assert.equal(dueLabel(makeBill({ nextDueDate: "2026-01-31" }), "2026-01-31"), "Due today");
  assert.equal(dueLabel(makeBill({ nextDueDate: "2026-02-01" }), "2026-01-31"), "Due tomorrow");
  assert.equal(dueLabel(makeBill({ nextDueDate: "2026-02-10" }), "2026-01-31"), "Due in 10 days");
});

test("bucketRecurringBills separates statuses and up-coming window", () => {
  const bills = [
    makeBill({ id: "soon", nextDueDate: "2026-01-05" }),
    makeBill({ id: "later", nextDueDate: "2026-03-01" }),
    makeBill({ id: "overdue", nextDueDate: "2025-12-01" }),
    makeBill({ id: "paused", status: "paused", nextDueDate: "2026-01-04" }),
    makeBill({ id: "done", status: "completed" }),
    makeBill({ id: "cancelled", status: "cancelled" }),
  ];

  const buckets = bucketRecurringBills(bills, { today: "2026-01-01", upcomingWindowDays: 30 });

  assert.deepEqual(buckets.active.map((b) => b.id), ["overdue", "soon", "later"]);
  assert.deepEqual(buckets.upcoming.map((b) => b.id), ["overdue", "soon"]);
  assert.deepEqual(buckets.paused.map((b) => b.id), ["paused"]);
  assert.deepEqual(buckets.completed.map((b) => b.id), ["done", "cancelled"]);
  assert.deepEqual(
    upcomingRecurringBills(bills, { today: "2026-01-01" }).map((b) => b.id),
    ["overdue", "soon"]
  );
});

test("billsForGroup isolates each group's schedules", () => {
  const bills = [makeBill({ id: "a", groupId: "g1" }), makeBill({ id: "b", groupId: "g2" })];
  assert.deepEqual(billsForGroup(bills, "g1").map((b) => b.id), ["a"]);
  assert.deepEqual(billsForGroup(bills, "g2").map((b) => b.id), ["b"]);
  assert.deepEqual(billsForGroup(bills, "g3"), []);
});

test("buildPaymentShares produces paise-safe shares summing to the amount", () => {
  const shares = buildPaymentShares(makeBill({ amount: 100, participantIds: ["u1", "u2", "u3"] }));
  const total = shares.reduce((sum, share) => sum + share.share_paise, 0);
  assert.equal(total, 10000);
  assert.deepEqual(shares.map((share) => share.user_id), ["u1", "u2", "u3"]);
  assert.ok(shares.every((share) => share.share_percentage === undefined));
});

test("buildPaymentShares includes percentages for percentage splits", () => {
  const shares = buildPaymentShares(
    makeBill({
      amount: 200,
      splitMethod: "percentage",
      participantIds: ["u1", "u2"],
      splitValues: { u1: 25, u2: 75 },
    })
  );

  assert.equal(shares.reduce((sum, share) => sum + share.share_paise, 0), 20000);
  assert.deepEqual(shares, [
    { user_id: "u1", share_paise: 5000, share_percentage: 25 },
    { user_id: "u2", share_paise: 15000, share_percentage: 75 },
  ]);
});

test("validateRecurringConfig accepts a valid config", () => {
  assert.equal(
    validateRecurringConfig({
      title: "Rent",
      amount: 100,
      category: "Rent",
      frequency: "monthly",
      startDate: "2026-01-31",
      endDate: "2026-12-31",
      participantIds: ["u1", "u2"],
      splitMethod: "equal",
      splitValues: {},
    }),
    true
  );
});

test("validateRecurringConfig rejects bad input", () => {
  const base = {
    title: "Rent",
    amount: 100,
    category: "Rent",
    frequency: "monthly",
    startDate: "2026-01-31",
    participantIds: ["u1", "u2"],
    splitMethod: "equal",
    splitValues: {},
  };

  assert.throws(() => validateRecurringConfig({ ...base, title: "  " }), /Enter a bill name/);
  assert.throws(() => validateRecurringConfig({ ...base, amount: 0 }), /amount greater than zero/);
  assert.throws(() => validateRecurringConfig({ ...base, frequency: "daily" }), /supported frequency/);
  assert.throws(() => validateRecurringConfig({ ...base, startDate: "" }), /start date/);
  assert.throws(
    () => validateRecurringConfig({ ...base, endDate: "2026-01-01" }),
    /End date cannot be before/
  );
  assert.throws(() => validateRecurringConfig({ ...base, participantIds: [] }), /at least one participant/);
  assert.throws(
    () =>
      validateRecurringConfig({
        ...base,
        splitMethod: "exact",
        splitValues: { u1: 10, u2: 10 },
      }),
    /Exact shares must add up/
  );
});

test("mapRecurringBill maps database rows into camelCase schedules", () => {
  const bill = mapRecurringBill({
    id: "b1",
    group_id: "g1",
    created_by: "u1",
    title: "Internet",
    amount: "799.00",
    currency: "INR",
    category: "Utilities",
    notes: null,
    frequency: "monthly",
    start_date: "2026-02-01",
    end_date: null,
    next_due_date: "2026-02-01",
    paid_by: "u1",
    split_type: "equal",
    participant_ids: ["u1", "u2"],
    split_values: {},
    status: "active",
    created_at: "2026-01-20T10:00:00.000Z",
  });

  assert.equal(bill.amount, 799);
  assert.equal(bill.groupId, "g1");
  assert.equal(bill.nextDueDate, "2026-02-01");
  assert.equal(bill.paidById, "u1");
  assert.equal(bill.splitMethod, "equal");
  assert.equal(bill.notes, "");
  assert.deepEqual(bill.participantIds, ["u1", "u2"]);
  assert.equal(typeof bill.createdAt, "number");
});

test("mapRecurringOccurrence and occurrencesForBill track payment history", () => {
  const occurrence = mapRecurringOccurrence({
    id: "o1",
    recurring_bill_id: "b1",
    group_id: "g1",
    occurrence_date: "2026-02-01",
    expense_id: "e1",
    recorded_by: "u1",
    recorded_at: "2026-02-01T09:00:00.000Z",
  });

  assert.equal(occurrence.billId, "b1");
  assert.equal(occurrence.expenseId, "e1");
  assert.equal(occurrence.occurrenceDate, "2026-02-01");

  const history = occurrencesForBill(
    [
      { id: "o1", billId: "b1", occurrenceDate: "2026-02-01" },
      { id: "o2", billId: "b1", occurrenceDate: "2026-03-01" },
      { id: "o3", billId: "b2", occurrenceDate: "2026-02-15" },
    ],
    "b1"
  );

  assert.deepEqual(history.map((row) => row.id), ["o2", "o1"]);
});
