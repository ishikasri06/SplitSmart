import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTheme,
  normalizeThemeMode,
  readStoredThemeMode,
  resolveTheme,
  writeStoredThemeMode,
} from "./theme.js";

// Owns the active theme mode. localStorage is the immediate source of truth so
// the correct theme paints before preferences load; once the signed-in user's
// saved preferences resolve, their stored value is adopted. Changing the mode
// applies instantly, persists locally, and (when signed in) saves to
// user_preferences.
export function useTheme(authUser, preferencesData) {
  const [mode, setModeState] = useState(() => readStoredThemeMode());
  // The concrete theme that is actually painted ('light' | 'dark'). Kept in
  // state so the header toggle icon stays correct even when the mode is
  // 'system' and the operating-system preference changes at runtime.
  const [resolved, setResolved] = useState(() => resolveTheme(readStoredThemeMode()));
  const adoptedUserId = useRef(null);

  const { preferences, exists, loading: prefsLoading, save } = preferencesData || {};

  // Apply on mount and whenever the mode or the OS preference changes.
  useEffect(() => {
    setResolved(applyTheme(mode));

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme(mode));
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [mode]);

  // Adopt the account's saved theme once, per signed-in user, when a row exists.
  useEffect(() => {
    const userId = authUser?.id ?? null;
    if (!userId || prefsLoading || !exists) return;
    if (adoptedUserId.current === userId) return;

    adoptedUserId.current = userId;
    const saved = normalizeThemeMode(preferences?.themeMode);
    setModeState(saved);
    writeStoredThemeMode(saved);
  }, [authUser?.id, prefsLoading, exists, preferences?.themeMode]);

  const setMode = useCallback(
    async (next) => {
      const normalized = normalizeThemeMode(next);
      setModeState(normalized);
      writeStoredThemeMode(normalized);

      if (authUser?.id && save) {
        try {
          await save({ ...preferences, themeMode: normalized });
        } catch {
          // Local preference still applies even if the save fails.
        }
      }

      return normalized;
    },
    [authUser?.id, preferences, save]
  );

  return { mode, resolved, setMode };
}
