import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapCloudSettlement, prepareSettlement } from "./cloudDashboard.js";

const settlementColumns =
  "id, group_id, paid_by, paid_to, amount, settled_at";

export function useCloudSettlements(authUser, groupId, enabled = true) {
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const recordSettlement = useCallback(
    async ({ fromId, toId, amount }) => {
      const payload = prepareSettlement({
        groupId,
        currentUserId: authUser?.id,
        fromId,
        toId,
        amount,
      });

      const { error: insertError } = await supabase.from("settlements").insert(payload);

      if (insertError) {
        throw new Error(insertError.message || "Could not record settlement.");
      }

      refresh();
    },
    [authUser?.id, groupId, refresh]
  );

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !authUser?.id || !groupId) {
      setSettlements([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadSettlements() {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("settlements")
        .select(settlementColumns)
        .eq("group_id", groupId)
        .order("settled_at", { ascending: false });

      if (cancelled) return;

      if (queryError) {
        setSettlements([]);
        setError(queryError.message || "Could not load settlements.");
      } else {
        setSettlements((data || []).map(mapCloudSettlement));
      }

      setLoading(false);
    }

    void loadSettlements();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, groupId, enabled, refreshToken]);

  return { settlements, loading, error, refresh, recordSettlement };
}
