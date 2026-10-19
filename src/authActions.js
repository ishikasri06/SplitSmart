import { supabase } from "./supabase.js";

// Updates the signed-in user's password through Supabase Auth. The chosen
// password is sent directly to Supabase over HTTPS and is never stored in the
// app database, logged, or kept in component state after success.
export async function changePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });

  if (error) {
    throw new Error(error.message || "Could not update your password.");
  }

  return data;
}
