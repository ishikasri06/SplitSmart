import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPersonalExpenses,
  mapPersonalExpenseRow,
  personalExpenseToRow,
  summarizePersonalExpenses,
  validatePersonalExpense,
} from "../src/personalExpenses.js";

test("validatePersonalExpense trims input, rounds amounts and defaults the category", () => {
  const value = validatePersonalExpense({
    title: "  Coffee  ",
    amount: "12.34",
    category: "Not a real category",
    date: "2026-01-05",
    notes: "  with a friend  ",
  });

  assert.equal(value.title, "Coffee");
  assert.equal(value.amount, 12.34);
  assert.equal(value.category, "Other");
  assert.equal(value.date, "2026-01-05");
  assert.equal(value.notes, "with a friend");
});

test("validatePersonalExpense rejects invalid input", () => {
  assert.throws(() => validatePersonalExpense({ title: "", amount: 5 }), /title/i);
  assert.throws(() => validatePersonalExpense({ title: "x", amount: 0 }), /greater than zero/);
  assert.throws(() => validatePersonalExpense({ title: "x", amount: -3 }), /greater than zero/);
  assert.throws(() => validatePersonalExpense({ title: "x", amount: 5, date: "05-01-2026" }), /valid date/);
});

test("personalExpenseToRow maps to snake_case and requires a signed-in user", () => {
  assert.throws(() => personalExpenseToRow("", { title: "x", amount: 1 }), /signed in/);

  const row = personalExpenseToRow("u1", {
    title: "Tea",
    amount: 40,
    category: "Food & drink",
    date: "2026-02-02",
    notes: "",
  });

  assert.deepEqual(row, {
    user_id: "u1",
    title: "Tea",
    amount: 40,
    currency: "INR",
    category: "Food & drink",
    expense_date: "2026-02-02",
    notes: null,
  });
});

test("mapPersonalExpenseRow produces a safe camelCase shape", () => {
  const mapped = mapPersonalExpenseRow({
    id: "p1",
    title: "Tea",
    amount: "40.00",
    category: "Food & drink",
    expense_date: "2026-02-02",
    notes: null,
    created_at: "2026-02-02T10:00:00Z",
  });

  assert.equal(mapped.amount, 40);
  assert.equal(mapped.date, "2026-02-02");
  assert.equal(mapped.notes, "");
  assert.equal(typeof mapped.createdAt, "number");
  assert.equal(mapPersonalExpenseRow(null), null);
});

test("summarizePersonalExpenses totals, averages and finds the top category", () => {
  const summary = summarizePersonalExpenses([
    { amount: 100, category: "Food & drink" },
    { amount: 300, category: "Travel" },
    { amount: 100, category: "Travel" },
  ]);

  assert.equal(summary.total, 500);
  assert.equal(summary.count, 3);
  assert.equal(summary.average, 500 / 3);
  assert.equal(summary.topCategory, "Travel");
  assert.equal(summary.topCategoryAmount, 400);
});

test("filterPersonalExpenses searches, filters and sorts newest first", () => {
  const list = [
    { title: "Lunch", category: "Food & drink", notes: "", date: "2026-01-02", createdAt: 2 },
    { title: "Cab", category: "Transport", notes: "airport ride", date: "2026-01-03", createdAt: 3 },
  ];

  assert.equal(filterPersonalExpenses(list, { category: "Transport" }).length, 1);
  assert.equal(filterPersonalExpenses(list, { search: "airport" })[0].title, "Cab");
  assert.equal(filterPersonalExpenses(list, { search: "lunch" })[0].title, "Lunch");
  assert.equal(filterPersonalExpenses(list, {})[0].title, "Cab");
});
