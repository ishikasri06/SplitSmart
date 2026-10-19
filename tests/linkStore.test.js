import test from "node:test";
import assert from "node:assert/strict";
import {
  saveGroupLinkToken,
  getGroupLinkToken,
  clearGroupLinkToken,
} from "../src/linkStore.js";

function withFakeStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  return map;
}

test("saves, reads and clears a token per group", () => {
  withFakeStorage();

  saveGroupLinkToken("g1", "token-one");
  saveGroupLinkToken("g2", "token-two");

  assert.equal(getGroupLinkToken("g1"), "token-one");
  assert.equal(getGroupLinkToken("g2"), "token-two");
  assert.equal(getGroupLinkToken("missing"), "");

  clearGroupLinkToken("g1");
  assert.equal(getGroupLinkToken("g1"), "");
  assert.equal(getGroupLinkToken("g2"), "token-two");
});

test("is a safe no-op when storage is unavailable", () => {
  delete globalThis.localStorage;

  assert.doesNotThrow(() => saveGroupLinkToken("g1", "token"));
  assert.equal(getGroupLinkToken("g1"), "");
  assert.doesNotThrow(() => clearGroupLinkToken("g1"));
});
