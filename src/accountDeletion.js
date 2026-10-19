// The exact phrase the user must type to confirm a permanent deletion.
export const DELETION_CONFIRMATION = "DELETE";

export const INVITE_LINK_PREFIX = "splitsmart:invite-link:";

// Supabase is imported lazily so this module's pure helpers can be imported in
// environments without browser/Supabase configuration (e.g. unit tests).
async function client() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

// The user must type the confirmation word exactly (trimmed). This mirrors the
// server-side requirement and is intentionally strict.
export function isDeletionConfirmed(value) {
  return String(value ?? "").trim() === DELETION_CONFIRMATION;
}

function storage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Removes cached, non-account app state (per-group invite link tokens) after a
// successful deletion or sign-out. The theme choice is a device preference and
// is intentionally left in place.
export function clearLocalAppState(store = storage()) {
  if (!store) return;
  try {
    const stale = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(INVITE_LINK_PREFIX)) stale.push(key);
    }
    stale.forEach((key) => store.removeItem(key));
  } catch {
    /* ignore */
  }
}

// Reports whether the signed-in user's account can be deleted yet, and why not
// if blockers exist (still a member of a shared group, shared expense history).
export async function fetchDeletionStatus() {
  const supabase = await client();
  const { data, error } = await supabase.rpc("my_account_deletion_status");

  if (error) {
    throw new Error(error.message || "Could not check your account status.");
  }

  return data;
}

async function readFunctionError(error) {
  const fallback = error?.message || "We could not delete your account. Please try again.";
  try {
    const response = error?.context;
    if (response && typeof response.json === "function") {
      const body = await response.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    }
  } catch {
    /* ignore body parse errors */
  }
  return fallback;
}

// Calls the trusted `delete-account` Edge Function, which verifies the caller's
// JWT and performs the deletion with the service role. The service-role key
// never reaches the browser.
export async function requestAccountDeletion() {
  const supabase = await client();
  const { data, error } = await supabase.functions.invoke("delete-account", {
    method: "POST",
  });

  if (error) {
    throw new Error(await readFunctionError(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}
