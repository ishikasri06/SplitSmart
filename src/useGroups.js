import { useCallback, useEffect, useState } from "react";
import { mapDatabaseGroup } from "./groupMappers.js";
import { supabase } from "./supabase";

const groupColumns =
  "id, name, group_type, description, created_by, created_at";

export function useGroups(authUser, enabled) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !authUser?.id) {
      setGroups([]);
      setLoading(false);
      setError(null);

      return () => {
        cancelled = true;
      };
    }

    async function loadGroups() {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("groups")
        .select(groupColumns)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (queryError) {
        setGroups([]);
        setError(
          queryError.message || "Could not load cloud groups."
        );
      } else {
        setGroups((data || []).map(mapDatabaseGroup));
      }

      setLoading(false);
    }

    void loadGroups();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, enabled, refreshToken]);

  async function createGroup(form) {
    if (!authUser?.id) {
      throw new Error(
        "You need to be signed in to create a cloud group."
      );
    }

    const { data, error: insertError } = await supabase
      .from("groups")
      .insert({
        name: form.name.trim(),
        group_type: form.type,
        description: form.description.trim() || null,
        created_by: authUser.id,
      })
      .select(groupColumns)
      .single();

    if (insertError) {
      throw new Error(
        insertError.message || "Could not create cloud group."
      );
    }

    const group = mapDatabaseGroup(data);

    setGroups((currentGroups) => [group, ...currentGroups]);

    return group;
  }

  const loadMembers = useCallback(async (groupId) => {
    if (!groupId) {
      throw new Error("Select a group first.");
    }

    const { data, error: queryError } = await supabase.rpc(
      "list_group_members",
      {
        target_group_id: groupId,
      }
    );

    if (queryError) {
      throw new Error(
        queryError.message || "Could not load group members."
      );
    }

    return data || [];
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return {
    groups,
    loading,
    error,
    createGroup,
    loadMembers,
    refresh,
  };
}