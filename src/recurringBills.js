import { splitExpense } from "./utils.js";

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];

export const FREQUENCY_LABELS = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const RECURRING_STATUS_LABELS = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function frequencyLabel(frequency) {
  return FREQUENCY_LABELS[frequency] || "Monthly";
}

export function statusLabel(status) {
  return RECURRING_STATUS_LABELS[status] || "Active";
}

export function isSupportedFrequency(frequency) {
  return RECURRING_FREQUENCIES.includes(frequency);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toISODate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Advance an ISO date (YYYY-MM-DD) by one frequency period. Month ends are
// clamped the same way Postgres does (Jan 31 + 1 month = Feb 28/29).
export function addFrequency(dateString, frequency) {
  if (!dateString) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return null;

  if (frequency === "weekly") {
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 7);
    return toISODate(next);
  }

  let targetYear = year;
  let targetMonth = month;

  if (frequency === "monthly") targetMonth = month + 1;
  else if (frequency === "quarterly") targetMonth = month + 3;
  else if (frequency === "yearly") targetYear = year + 1;
  else return null;

  targetYear += Math.floor((targetMonth - 1) / 12);
  targetMonth = ((targetMonth - 1) % 12) + 1;

  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return toISODate(new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(day, lastDay))));
}

function isoToUTC(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysUntil(dateString, today = todayISO()) {
  if (!dateString) return Infinity;
  return Math.round((isoToUTC(dateString) - isoToUTC(today)) / 86400000);
}

export function isBillDue(bill, today = todayISO()) {
  return bill?.status === "active" && daysUntil(bill.nextDueDate, today) <= 0;
}

export function dueLabel(bill, today = todayISO()) {
  const days = daysUntil(bill?.nextDueDate, today);
  if (!Number.isFinite(days)) return "No due date";
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function billsForGroup(bills, groupId) {
  const list = Array.isArray(bills) ? bills : [];
  return list.filter((bill) => bill.groupId === groupId);
}

export function mapRecurringBill(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    createdBy: row.created_by,
    title: row.title,
    amount: Number(row.amount),
    currency: row.currency || "INR",
    category: row.category,
    notes: row.notes || "",
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date || null,
    nextDueDate: row.next_due_date,
    paidById: row.paid_by,
    splitMethod: row.split_type,
    participantIds: Array.isArray(row.participant_ids) ? row.participant_ids : [],
    splitValues: row.split_values || {},
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
  };
}

export function mapRecurringOccurrence(row) {
  return {
    id: row.id,
    billId: row.recurring_bill_id,
    groupId: row.group_id,
    occurrenceDate: row.occurrence_date,
    expenseId: row.expense_id,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at ? new Date(row.recorded_at).getTime() : 0,
  };
}

export function occurrencesForBill(occurrences, billId) {
  const list = Array.isArray(occurrences) ? occurrences : [];
  return list
    .filter((occurrence) => occurrence.billId === billId)
    .sort((a, b) => (a.occurrenceDate < b.occurrenceDate ? 1 : -1));
}

export function bucketRecurringBills(bills, { today = todayISO(), upcomingWindowDays = 30 } = {}) {
  const list = Array.isArray(bills) ? bills : [];
  const byDue = (a, b) => (a.nextDueDate < b.nextDueDate ? -1 : a.nextDueDate > b.nextDueDate ? 1 : 0);

  const active = list.filter((bill) => bill.status === "active").sort(byDue);
  const paused = list.filter((bill) => bill.status === "paused").sort(byDue);
  const completed = list
    .filter((bill) => bill.status === "completed" || bill.status === "cancelled")
    .sort(byDue);
  const upcoming = active.filter((bill) => daysUntil(bill.nextDueDate, today) <= upcomingWindowDays);

  return { upcoming, active, paused, completed };
}

export function upcomingRecurringBills(bills, options = {}) {
  return bucketRecurringBills(bills, options).upcoming;
}

export function buildPaymentShares(bill) {
  const amount = Number(bill?.amount);
  const ids = [...new Set(bill?.participantIds || [])];
  const shares = splitExpense(amount, ids, bill?.splitMethod || "equal", bill?.splitValues || {});

  return ids.map((id) => {
    const entry = { user_id: id, share_paise: Math.round(Number(shares[id]) * 100) };
    if (bill?.splitMethod === "percentage") {
      entry.share_percentage = Number(bill?.splitValues?.[id] ?? 0);
    }
    return entry;
  });
}

export function validateRecurringConfig({
  title,
  amount,
  category,
  frequency,
  startDate,
  endDate,
  participantIds,
  splitMethod,
  splitValues,
} = {}) {
  if (!title || !title.trim()) throw new Error("Enter a bill name.");
  if (title.trim().length > 200) throw new Error("Bill name must be 200 characters or fewer.");
  if (!category) throw new Error("Choose a category.");

  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }

  if (!isSupportedFrequency(frequency)) throw new Error("Choose a supported frequency.");
  if (!startDate) throw new Error("Choose a start date.");
  if (endDate && endDate < startDate) throw new Error("End date cannot be before the start date.");

  const ids = [...new Set(participantIds || [])];
  if (ids.length === 0) throw new Error("Choose at least one participant.");

  // splitExpense throws with a helpful message on invalid split totals.
  splitExpense(numeric, ids, splitMethod || "equal", splitValues || {});

  return true;
}
