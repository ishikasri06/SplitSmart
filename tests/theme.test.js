import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  THEME_MODE_LABELS,
  THEME_STORAGE_KEY,
  isThemeMode,
  normalizeThemeMode,
  resolveTheme,
  readStoredThemeMode,
  writeStoredThemeMode,
  clearStoredThemeMode,
  systemPrefersDark,
  applyTheme,
} from "../src/theme.js";

function withFakeStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  return map;
}

test("exposes the three supported modes and their labels", () => {
  assert.deepEqual(THEME_MODES, ["system", "light", "dark"]);
  assert.equal(DEFAULT_THEME_MODE, "system");
  assert.equal(THEME_STORAGE_KEY, "splitsmart:theme");
  assert.deepEqual(THEME_MODE_LABELS, { system: "System", light: "Light", dark: "Dark" });
});

test("normalizeThemeMode coerces unknown values to system", () => {
  assert.equal(normalizeThemeMode("dark"), "dark");
  assert.equal(normalizeThemeMode("light"), "light");
  assert.equal(normalizeThemeMode("system"), "system");
  assert.equal(normalizeThemeMode("sepia"), "system");
  assert.equal(normalizeThemeMode(null), "system");
  assert.equal(normalizeThemeMode(undefined), "system");
  assert.equal(isThemeMode("dark"), true);
  assert.equal(isThemeMode("nope"), false);
});

test("resolveTheme maps system to the OS preference and passes through others", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("garbage", true), "dark");
});

test("stores, reads and clears the theme mode", () => {
  const map = withFakeStorage();

  assert.equal(readStoredThemeMode(), "system");
  writeStoredThemeMode("dark");
  assert.equal(map.get(THEME_STORAGE_KEY), "dark");
  assert.equal(readStoredThemeMode(), "dark");

  writeStoredThemeMode("invalid");
  assert.equal(readStoredThemeMode(), "system");

  clearStoredThemeMode();
  assert.equal(readStoredThemeMode(), "system");
});

test("storage helpers are safe no-ops without localStorage", () => {
  delete globalThis.localStorage;

  assert.equal(readStoredThemeMode(), "system");
  assert.doesNotThrow(() => writeStoredThemeMode("dark"));
  assert.doesNotThrow(() => clearStoredThemeMode());
});

test("systemPrefersDark reads matchMedia safely", () => {
  assert.equal(systemPrefersDark(null), false);
  assert.equal(systemPrefersDark({}), false);
  assert.equal(
    systemPrefersDark({ matchMedia: () => ({ matches: true }) }),
    true
  );
});

test("applyTheme paints the resolved theme on the root element", () => {
  const attributes = {};
  const root = {
    style: {},
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
  };

  assert.equal(applyTheme("system", { root, prefersDark: true }), "dark");
  assert.equal(attributes["data-theme"], "dark");
  assert.equal(root.style.colorScheme, "dark");

  assert.equal(applyTheme("light", { root, prefersDark: true }), "light");
  assert.equal(attributes["data-theme"], "light");
  assert.equal(root.style.colorScheme, "light");

  assert.equal(applyTheme("system", { root }), "light");
  assert.equal(attributes["data-theme"], "light");
});

test("applyTheme is a safe no-op when there is no root element", () => {
  assert.equal(applyTheme("dark", { root: null }), "light");
});
