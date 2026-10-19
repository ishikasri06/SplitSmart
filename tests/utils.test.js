import test from "node:test";
import assert from "node:assert/strict";
import { splitExpense, calculateBalances, simplifyDebts } from "../src/utils.js";

test("equal split distributes remainder by paise and sums to total", () => {
  const shares = splitExpense(100, ["a", "b", "c"], "equal");
  assert.equal(Object.values(shares).reduce((a,b) => a+b, 0), 100);
  assert.deepEqual(Object.values(shares), [33.34, 33.33, 33.33]);
});

test("exact split validates total", () => {
  assert.throws(() => splitExpense(100, ["a","b"], "exact", {a: 20, b: 70}), /add up/);
  assert.deepEqual(splitExpense(100, ["a","b"], "exact", {a: 20, b: 80}), {a:20,b:80});
});

test("percentage split validates and sums to total", () => {
  assert.throws(() => splitExpense(100, ["a","b"], "percentage", {a:30,b:30}), /100%/);
  const shares = splitExpense(99.99, ["a","b","c"], "percentage", {a:33.33,b:33.33,c:33.34});
  assert.equal(Math.round(Object.values(shares).reduce((a,b)=>a+b,0)*100), 9999);
});

test("balances reflect payer credit and participant shares", () => {
  const expenses = [{ paidById:"a", amount:90, shares:{a:30,b:30,c:30} }];
  assert.deepEqual(calculateBalances(expenses), {a:60,b:-30,c:-30});
});

test("settlements reduce outstanding debt", () => {
  const balances = calculateBalances(
    [{ paidById:"a", amount:90, shares:{a:30,b:30,c:30} }],
    [{ fromId:"b", toId:"a", amount:30 }]
  );
  assert.deepEqual(balances, {a:30,b:0,c:-30});
});

test("simplifies debts into transfers", () => {
  assert.deepEqual(simplifyDebts({a:60,b:-30,c:-30}), [
    {fromId:"b",toId:"a",amount:30},
    {fromId:"c",toId:"a",amount:30}
  ]);
});
