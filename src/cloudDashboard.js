import { calculateBalances } from "./utils.js";

export function mapCloudExpense(row) {
  const shareRows = row.expense_shares || [];

  const shares = Object.fromEntries(
    shareRows.map((share) => [share.user_id, Number(share.share_amount)])
  );

  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    amount: Number(row.amount),
    category: row.category,
    paidById: row.paid_by,
    date: row.expense_date,
    notes: row.notes || "",
    splitMethod: row.split_type,
    participantIds: shareRows.map((share) => share.user_id),
    shares,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function mapCloudSettlement(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    fromId: row.paid_by,
    toId: row.paid_to,
    amount: Number(row.amount),
    date: row.settled_at,
  };
}

export function prepareSettlement({
  groupId,
  currentUserId,
  fromId,
  toId,
  amount,
  settledAt,
} = {}) {
  if (!currentUserId) throw new Error("You must be signed in.");
  if (!groupId) throw new Error("Select a group first.");
  if (!fromId || !toId) throw new Error("Choose who pays whom.");
  if (fromId === toId) throw new Error("A member cannot settle with themselves.");
  if (fromId !== currentUserId) {
    throw new Error("Only the payer can record this settlement.");
  }

  const numeric = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Enter a valid settlement amount.");
  }

  return {
    group_id: groupId,
    paid_by: fromId,
    paid_to: toId,
    amount: numeric,
    settled_at: settledAt || new Date().toISOString(),
  };
}

export function computeCloudDashboard({
  expenses = [],
  settlements = [],
  currentUserId,
} = {}) {
  const list = Array.isArray(expenses) ? expenses : [];
  const payments = Array.isArray(settlements) ? settlements : [];

  const total = list.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const count = list.length;
  const average = count ? total / count : 0;
  const balances = calculateBalances(list, payments);
  const myNet = currentUserId != null ? Number(balances[currentUserId] || 0) : 0;

  return {
    total,
    count,
    average,
    balances,
    myNet,
    currentPositive: Object.entries(balances).filter(
      ([id, value]) => id !== currentUserId && value < -0.009
    ).length,
  };
}
