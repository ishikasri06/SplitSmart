import { money } from "./utils.js";

// Personal expenses share the same category vocabulary as group expenses so the
// UI feels consistent. They deliberately never belong to a group.
export const PERSONAL_EXPENSE_CATEGORIES = [
  "Groceries",
  "Utilities",
  "Food & drink",
  "Transport",
  "Travel",
  "Household",
  "Rent",
  "Other",
];

export const PERSONAL_DEFAULT_CATEGORY = "Other";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isPersonalCategory(category) {
  return PERSONAL_EXPENSE_CATEGORIES.includes(category);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Strict validation used before writing to Supabase. Throws on invalid input so
// the modal can surface a friendly message instead of silently coercing.
export function validatePersonalExpense(input = {}) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Enter a title for this expense.");
  if (title.length > 200) throw new Error("Keep the title under 200 characters.");

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }

  const category = isPersonalCategory(input.category)
    ? input.category
    : PERSONAL_DEFAULT_CATEGORY;

  const date = String(input.date ?? "").trim() || todayIsoDate();
  if (!ISO_DATE.test(date)) throw new Error("Choose a valid date.");

  const notes = String(input.notes ?? "").trim();
  if (notes.length > 2000) throw new Error("Keep notes under 2000 characters.");

  return { title, amount, category, date, notes };
}

export function personalExpenseToRow(userId, input = {}) {
  if (!userId) {
    throw new Error("You must be signed in to save a personal expense.");
  }

  const value = validatePersonalExpense(input);

  return {
    user_id: userId,
    title: value.title,
    amount: value.amount,
    currency: "INR",
    category: value.category,
    expense_date: value.date,
    notes: value.notes || null,
  };
}

export function mapPersonalExpenseRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    category: row.category || PERSONAL_DEFAULT_CATEGORY,
    date: row.expense_date || null,
    notes: row.notes || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
  };
}

export function sumPersonalExpenses(expenses = []) {
  return (Array.isArray(expenses) ? expenses : []).reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0
  );
}

export function summarizePersonalExpenses(expenses = []) {
  const list = Array.isArray(expenses) ? expenses : [];
  const total = sumPersonalExpenses(list);
  const count = list.length;

  const byCategory = {};
  for (const expense of list) {
    byCategory[expense.category] =
      (byCategory[expense.category] || 0) + Number(expense.amount || 0);
  }

  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    total,
    count,
    average: count ? total / count : 0,
    byCategory,
    topCategory: top ? top[0] : null,
    topCategoryAmount: top ? top[1] : 0,
  };
}

export function filterPersonalExpenses(expenses = [], { search = "", category = "All" } = {}) {
  const query = String(search ?? "").trim().toLowerCase();

  return (Array.isArray(expenses) ? expenses : [])
    .filter((expense) => {
      const matchesCategory = category === "All" || expense.category === category;
      const haystack = `${expense.title} ${expense.category} ${expense.notes || ""}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesCategory && matchesSearch;
    })
    .sort(
      (a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")) ||
        Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

export function personalExpenseSummaryLabel(expenses = []) {
  const { total, count } = summarizePersonalExpenses(expenses);
  return `${count} ${count === 1 ? "expense" : "expenses"} · ${money(total)}`;
}
