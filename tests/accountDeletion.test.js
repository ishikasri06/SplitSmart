import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETION_CONFIRMATION,
  INVITE_LINK_PREFIX,
  isDeletionConfirmed,
  clearLocalAppState,
} from "../src/accountDeletion.js";

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

test("confirmation must match the exact phrase (trimmed)", () => {
  assert.equal(DELETION_CONFIRMATION, "DELETE");
  assert.equal(isDeletionConfirmed("DELETE"), true);
  assert.equal(isDeletionConfirmed("  DELETE  "), true);
  assert.equal(isDeletionConfirmed("delete"), false);
  assert.equal(isDeletionConfirmed("DELETE!"), false);
  assert.equal(isDeletionConfirmed(""), false);
  assert.equal(isDeletionConfirmed(null), false);
  assert.equal(isDeletionConfirmed(undefined), false);
});

test("clearLocalAppState removes only cached invite-link tokens", () => {
  const store = fakeStore({
    [`${INVITE_LINK_PREFIX}g1`]: "token-one",
    [`${INVITE_LINK_PREFIX}g2`]: "token-two",
    "splitsmart:theme": "dark",
    unrelated: "keep-me",
  });

  clearLocalAppState(store);

  assert.equal(store.has(`${INVITE_LINK_PREFIX}g1`), false);
  assert.equal(store.has(`${INVITE_LINK_PREFIX}g2`), false);
  assert.equal(store.getItem("splitsmart:theme"), "dark");
  assert.equal(store.getItem("unrelated"), "keep-me");
  assert.equal(store.length, 2);
});

test("clearLocalAppState is a safe no-op without storage", () => {
  assert.doesNotThrow(() => clearLocalAppState(null));
  assert.doesNotThrow(() => clearLocalAppState(undefined));
});
