import test from "node:test";
import assert from "node:assert/strict";
import { calculateBalances, simplifyDebts } from "../src/utils.js";

test("simplifyDebts settles a single expense with one payment per debtor", () => {
  const expenses = [{ paidById: "a", amount: 300, shares: { a: 75, b: 75, c: 75, d: 75 } }];
  const balances = calculateBalances(expenses);

  const transfers = simplifyDebts(balances);

  assert.equal(transfers.length, 3);
  assert.ok(transfers.every((transfer) => transfer.toId === "a"));
  assert.equal(transfers.reduce((sum, transfer) => sum + transfer.amount, 0), 225);
});

test("simplifyDebts never uses more transfers than participants minus one", () => {
  const transfers = simplifyDebts({ a: 100, b: 60, c: -80, d: -50, e: -30 });

  assert.ok(transfers.length <= 5 - 1);

  const paid = transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
  assert.ok(Math.abs(paid - 160) < 0.001);

  const received = transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
  assert.equal(paid, received);
});

test("simplifyDebts returns nothing when balances are effectively settled", () => {
  assert.deepEqual(simplifyDebts({ a: 0.004, b: -0.004 }), []);
  assert.deepEqual(simplifyDebts({ a: 0, b: 0 }), []);
});

test("simplifyDebts respects recorded settlements in the resulting plan", () => {
  const balances = calculateBalances(
    [{ paidById: "a", amount: 90, shares: { a: 30, b: 30, c: 30 } }],
    [{ fromId: "b", toId: "a", amount: 30 }]
  );

  const transfers = simplifyDebts(balances);

  assert.deepEqual(transfers, [{ fromId: "c", toId: "a", amount: 30 }]);
});
