import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE_EPSILON,
  hasOutstandingBalance,
  outstandingBalanceMessage,
} from "../src/balanceGuard.js";

test("hasOutstandingBalance ignores tiny rounding noise", () => {
  assert.equal(hasOutstandingBalance(0), false);
  assert.equal(hasOutstandingBalance(0.004), false);
  assert.equal(hasOutstandingBalance(-0.004), false);
  assert.equal(hasOutstandingBalance("0.00"), false);
  assert.equal(hasOutstandingBalance(NaN), false);
  assert.equal(BALANCE_EPSILON, 0.005);
});

test("hasOutstandingBalance flags real balances in either direction", () => {
  assert.equal(hasOutstandingBalance(0.01), true);
  assert.equal(hasOutstandingBalance(-125.5), true);
  assert.equal(hasOutstandingBalance(200), true);
});

test("outstandingBalanceMessage covers self-leave and admin-removal phrasing", () => {
  assert.match(outstandingBalanceMessage(-200, { self: true }), /Settle up before leaving/);
  assert.match(outstandingBalanceMessage(200, { name: "Asha" }), /Asha/);
  assert.match(outstandingBalanceMessage(200, { name: "Asha" }), /cannot be removed/);
});
