// Supabase Edge Function: delete-account
//
// Securely deletes the CALLER'S own account. The caller is identified from the
// JWT that Supabase passes in the Authorization header; the service-role key is
// read from the function's environment and NEVER exposed to the browser.
//
// Flow:
//   1. Verify the caller's JWT with an anon client (auth.getUser).
//   2. Run the data-policy + cleanup RPC with the service role. This preserves
//      shared financial records and other members' balances, and refuses to run
//      while blockers exist.
//   3. Only if the cleanup succeeded, delete the auth user.
//
// Deploy:  supabase functions deploy delete-account
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
//  automatically by the Supabase Edge Functions runtime.)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Deletion is not configured on the server." }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "You must be signed in to delete your account." }, 401);
    }

    // Identify the caller from their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData?.user) {
      return json({ error: "Your session is no longer valid. Please sign in again." }, 401);
    }

    const userId = userData.user.id;

    // Perform the policy-checked cleanup with the service role.
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: cleanup, error: cleanupError } = await adminClient.rpc(
      "delete_own_account_data",
      { p_user_id: userId },
    );

    if (cleanupError) {
      return json({ error: cleanupError.message }, 500);
    }

    if (!cleanup?.ok) {
      return json(
        {
          error:
            cleanup?.error ??
            "Your account cannot be deleted while it is linked to shared groups.",
          blockers: cleanup?.blockers ?? [],
        },
        409,
      );
    }

    // Finally remove the auth user itself.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      return json({ error: deleteError.message }, 500);
    }

    return json({
      ok: true,
      deleted_groups: cleanup.deleted_groups ?? 0,
      reassigned_owners: cleanup.reassigned_owners ?? 0,
    });
  } catch (error) {
    return json(
      { error: (error as Error)?.message || "Unexpected error while deleting the account." },
      500,
    );
  }
});
