import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  DEFAULT_PREFERENCES,
  mapPreferencesRow,
  preferencesToRow,
} from "./preferences.js";

const preferenceColumns =
  "user_id, currency, default_split_method, notify_recurring_bills, notify_invitations, notify_activity, reminder_lead_days, theme_mode";

export function usePreferences(authUser) {
  const [state, setState] = useState({
    userId: authUser?.id ?? null,
    preferences: DEFAULT_PREFERENCES,
    exists: false,
    loading: Boolean(authUser?.id),
    error: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!authUser?.id) {
      setState({
        userId: null,
        preferences: DEFAULT_PREFERENCES,
        exists: false,
        loading: false,
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    // Reset immediately so a previous account's preferences can never leak
    // while the new account's row is being fetched.
    setState({
      userId: authUser.id,
      preferences: DEFAULT_PREFERENCES,
      exists: false,
      loading: true,
      error: null,
    });

    async function loadPreferences() {
      const { data, error } = await supabase
        .from("user_preferences")
        .select(preferenceColumns)
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (cancelled) return;

      setState({
        userId: authUser.id,
        preferences: mapPreferencesRow(data),
        exists: Boolean(data),
        loading: false,
        error: error?.message ?? null,
      });
    }

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const save = useCallback(
    async (input) => {
      if (!authUser?.id) {
        throw new Error("You must be signed in to save preferences.");
      }

      setSaving(true);

      try {
        const row = preferencesToRow(authUser.id, input);
        const { error } = await supabase
          .from("user_preferences")
          .upsert(row, { onConflict: "user_id" });

        if (error) {
          throw new Error(error.message || "Could not save your preferences.");
        }

        const next = mapPreferencesRow(row);
        setState((current) => ({ ...current, preferences: next, exists: true, error: null }));
        return next;
      } finally {
        setSaving(false);
      }
    },
    [authUser?.id]
  );

  // Only expose preferences that belong to the currently active account.
  const matchesCurrentUser = state.userId === (authUser?.id ?? null);

  return {
    preferences: matchesCurrentUser ? state.preferences : DEFAULT_PREFERENCES,
    exists: matchesCurrentUser ? state.exists : false,
    loading: matchesCurrentUser ? state.loading : Boolean(authUser?.id),
    error: matchesCurrentUser ? state.error : null,
    saving,
    refresh,
    save,
  };
}
