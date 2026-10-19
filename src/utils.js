export const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));

export function splitExpense(total, memberIds, method = "equal", customValues = {}) {
  const amount = Math.round(Number(total) * 100);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!Array.isArray(memberIds) || memberIds.length === 0) throw new Error("Choose at least one participant.");
  const ids = [...new Set(memberIds)];
  const shares = {};
  if (method === "equal") {
    const base = Math.floor(amount / ids.length);
    let remainder = amount - base * ids.length;
    ids.forEach((id) => {
      shares[id] = base + (remainder-- > 0 ? 1 : 0);
    });
  } else if (method === "exact") {
    let sum = 0;
    ids.forEach((id) => {
      const cents = Math.round(Number(customValues[id] || 0) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Exact shares must be zero or greater.");
      shares[id] = cents;
      sum += cents;
    });
    if (sum !== amount) throw new Error(`Exact shares must add up to ${money(amount / 100)}.`);
  } else if (method === "percentage") {
    const values = ids.map((id) => Number(customValues[id] || 0));
    if (values.some((v) => !Number.isFinite(v) || v < 0) || Math.abs(values.reduce((a, b) => a + b, 0) - 100) > 0.001) {
      throw new Error("Percentages must be non-negative and add up to 100%.");
    }
    let allocated = 0;
    ids.forEach((id, index) => {
      const cents = index === ids.length - 1
        ? amount - allocated
        : Math.floor(amount * values[index] / 100);
      shares[id] = cents;
      allocated += cents;
    });
  } else {
    throw new Error("Choose a supported split method.");
  }
  return Object.fromEntries(Object.entries(shares).map(([id, cents]) => [id, cents / 100]));
}

export function calculateBalances(expenses, settlements = []) {
  const net = {};
  const add = (id, value) => { net[id] = (net[id] || 0) + value; };
  for (const expense of expenses) {
    const payer = expense.paidById;
    add(payer, Number(expense.amount || 0));
    for (const [memberId, share] of Object.entries(expense.shares || {})) {
      add(memberId, -Number(share || 0));
    }
  }
  for (const payment of settlements) {
    const amount = Number(payment.amount || 0);
    add(payment.fromId, amount);
    add(payment.toId, -amount);
  }
  Object.keys(net).forEach((id) => { net[id] = Math.round(net[id] * 100) / 100; });
  return net;
}

export function simplifyDebts(netBalances) {
  const creditors = [];
  const debtors = [];
  Object.entries(netBalances).forEach(([memberId, rawAmount]) => {
    const amount = Math.round(Number(rawAmount) * 100) / 100;
    if (amount > 0.009) creditors.push({ memberId, amount });
    if (amount < -0.009) debtors.push({ memberId, amount: -amount });
  });
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.round(Math.min(debtors[i].amount, creditors[j].amount) * 100) / 100;
    if (amount > 0) transfers.push({ fromId: debtors[i].memberId, toId: creditors[j].memberId, amount });
    debtors[i].amount = Math.round((debtors[i].amount - amount) * 100) / 100;
    creditors[j].amount = Math.round((creditors[j].amount - amount) * 100) / 100;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }
  return transfers;
}
