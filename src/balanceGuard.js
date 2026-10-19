import { money } from "./utils.js";

// Amounts in rupees; anything at or below this is treated as settled to avoid
// blocking on floating-point noise. Matches the SQL guard's 0.005 threshold.
export const BALANCE_EPSILON = 0.005;

export function hasOutstandingBalance(net) {
  const value = Number(net);
  return Number.isFinite(value) && Math.abs(value) > BALANCE_EPSILON;
}

export function outstandingBalanceMessage(net, { self = false, name = "This member" } = {}) {
  const amount = money(Math.abs(Number(net) || 0));

  return self
    ? `You have an outstanding balance of ${amount} in this group. Settle up before leaving.`
    : `${name} has an outstanding balance of ${amount} and cannot be removed until it is settled.`;
}
