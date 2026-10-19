// Theme handling for SplitSmart. Pure helpers are exported for tests; the DOM
// helpers are guarded so importing this module in Node never touches globals.

export const THEME_MODES = ["system", "light", "dark"];

export const DEFAULT_THEME_MODE = "system";

export const THEME_MODE_LABELS = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_STORAGE_KEY = "splitsmart:theme";

export function isThemeMode(value) {
  return THEME_MODES.includes(value);
}

// Coerce any input into a supported theme mode, defaulting to the system mode.
export function normalizeThemeMode(value) {
  return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

// Resolve a stored mode into the concrete theme that should be painted.
export function resolveTheme(mode, systemPrefersDark = false) {
  const normalized = normalizeThemeMode(mode);
  if (normalized === "system") return systemPrefersDark ? "dark" : "light";
  return normalized;
}

function storage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    /* localStorage can throw in private mode or when disabled */
  }
  return null;
}

export function readStoredThemeMode(store = storage()) {
  if (!store) return DEFAULT_THEME_MODE;
  try {
    return normalizeThemeMode(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function writeStoredThemeMode(mode, store = storage()) {
  if (!store) return;
  try {
    store.setItem(THEME_STORAGE_KEY, normalizeThemeMode(mode));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function clearStoredThemeMode(store = storage()) {
  if (!store) return;
  try {
    store.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Reads the OS-level colour-scheme preference. Guarded for non-browser runs.
export function systemPrefersDark(target = typeof window !== "undefined" ? window : null) {
  if (!target || typeof target.matchMedia !== "function") return false;
  try {
    return target.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// Applies the resolved theme to <html>. Kept separate from React so the early
// bootstrap script in index.html can share the exact same key + resolution.
export function applyTheme(mode, { root, prefersDark } = {}) {
  const doc =
    root ||
    (typeof document !== "undefined" ? document.documentElement : null);
  if (!doc) return "light";

  const resolved = resolveTheme(mode, prefersDark ?? systemPrefersDark());
  doc.setAttribute("data-theme", resolved);
  doc.style.colorScheme = resolved;

  if (typeof document !== "undefined" && document.querySelector) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolved === "dark" ? "#14121d" : "#f7f5ff"
      );
    }
  }

  return resolved;
}
