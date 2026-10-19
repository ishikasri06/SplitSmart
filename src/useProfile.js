import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { deriveProfileName } from "./profileUtils";

export {
  deriveProfileName,
  getProfileDisplayName,
  getUserInitials,
} from "./profileUtils";

// A profile row is created by the public.handle_new_user() trigger at signup.
// If it is ever missing (for example the row was removed by hand), every
// profiles-based join -- most importantly public.list_group_members() -- silently
// drops the member, which empties member lists, split participants and balance
// labels. Instead of rendering that broken state, we rebuild our own row through
// the normal RLS "Create own profile" policy and re-read until it appears.
const REPAIR_ATTEMPTS = 3;
const REPAIR_RETRY_DELAY_MS = 400;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useProfile(authUser) {
  const [state, setState] = useState({
    userId: authUser?.id ?? null,
    profile: null,
    loading: Boolean(authUser?.id),
    repairing: false,
    missing: false,
    error: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!authUser?.id) {
      setState({
        userId: null,
        profile: null,
        loading: false,
        repairing: false,
        missing: false,
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    // Reset immediately so a previous account's profile can never leak while
    // the new account's profile row is being fetched.
    setState({
      userId: authUser.id,
      profile: null,
      loading: true,
      repairing: false,
      missing: false,
      error: null,
    });

    const readProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", authUser.id)
        .maybeSingle();

      return { data, error };
    };

    async function loadProfile() {
      let { data, error } = await readProfile();

      if (cancelled) return;

      let failure = error?.message ?? null;
      let repairing = false;

      // Only self-heal when the row is genuinely absent (data === null) and the
      // read itself did not fail. maybeSingle() returns data === null exactly
      // when zero rows matched, i.e. the profile is missing.
      for (
        let attempt = 0;
        !data && !failure && attempt < REPAIR_ATTEMPTS;
        attempt += 1
      ) {
        repairing = true;
        setState({
          userId: authUser.id,
          profile: null,
          loading: true,
          repairing: true,
          missing: false,
          error: null,
        });

        const fullName = deriveProfileName(authUser);
        const { error: writeError } = await supabase.from("profiles").upsert(
          fullName ? { id: authUser.id, full_name: fullName } : { id: authUser.id },
          { onConflict: "id" }
        );

        if (cancelled) return;

        if (writeError) {
          failure = writeError.message || "Could not restore your profile.";
          break;
        }

        await wait(REPAIR_RETRY_DELAY_MS);

        if (cancelled) return;

        ({ data, error } = await readProfile());

        if (cancelled) return;

        failure = error?.message ?? null;
      }

      if (cancelled) return;

      const missing = !data && !failure;

      setState({
        userId: authUser.id,
        profile: data ?? null,
        loading: false,
        repairing: false,
        missing,
        error:
          failure ||
          (missing ? "Your profile could not be restored automatically." : null),
      });
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const updateName = useCallback(
    async (fullName) => {
      if (!authUser?.id) {
        throw new Error("You need to be signed in to update your profile.");
      }

      const trimmed = String(fullName ?? "").trim();

      if (!trimmed) {
        throw new Error("Enter a display name.");
      }

      const { error } = await supabase
        .from("profiles")
        .upsert({ id: authUser.id, full_name: trimmed }, { onConflict: "id" });

      if (error) {
        throw new Error(error.message || "Could not update your profile.");
      }

      setRefreshToken((value) => value + 1);
    },
    [authUser?.id]
  );

  // Only expose a profile that belongs to the currently active account, so a
  // stale row from a previous session can never render during an account switch.
  const matchesCurrentUser = state.userId === (authUser?.id ?? null);

  return {
    profile: matchesCurrentUser ? state.profile : null,
    loading: matchesCurrentUser ? state.loading : Boolean(authUser?.id),
    repairing: matchesCurrentUser ? state.repairing : false,
    missing: matchesCurrentUser ? state.missing : false,
    error: matchesCurrentUser ? state.error : null,
    refresh,
    updateName,
  };
}
