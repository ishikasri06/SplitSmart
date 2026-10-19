import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { mapNotificationRow, sortNotifications, unreadCount } from "./notifications.js";

const notificationColumns =
  "id, user_id, actor_id, actor_name, group_id, group_name, type, title, body, amount, entity_type, entity_id, read_at, created_at";

const POLL_INTERVAL_MS = 60_000;
const NOTIFICATION_LIMIT = 50;

// In-app notifications are read-only to the client (written by SECURITY DEFINER
// triggers). We poll while the app is open and refresh on focus/visibility so a
// new alert shows up without a websocket dependency.
export function useNotifications(authUser, enabled = true) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const userId = authUser?.id || null;

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !userId) {
      setItems([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function load(initial) {
      if (initial) setLoading(true);

      const { data, error: queryError } = await supabase
        .from("notifications")
        .select(notificationColumns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_LIMIT);

      if (cancelled) return;

      if (queryError) {
        if (initial) setItems([]);
        setError(queryError.message || "Could not load notifications.");
      } else {
        setItems(sortNotifications((data || []).map(mapNotificationRow)));
        setError(null);
      }

      if (initial) setLoading(false);
    }

    void load(true);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, POLL_INTERVAL_MS);

    const handleFocus = () => void load(false);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId, enabled, refreshToken]);

  const markRead = useCallback(
    async (notificationId) => {
      if (!userId || !notificationId) return;

      const nowIso = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readAt: item.readAt || nowIso } : item
        )
      );

      const { error: updateError } = await supabase
        .from("notifications")
        .update({ read_at: nowIso })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .is("read_at", null);

      if (updateError) {
        setError(updateError.message || "Could not update the notification.");
        refresh();
      }
    },
    [userId, refresh]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;

    const nowIso = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: nowIso })));

    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: nowIso })
      .eq("user_id", userId)
      .is("read_at", null);

    if (updateError) {
      setError(updateError.message || "Could not update notifications.");
      refresh();
    }
  }, [userId, refresh]);

  return {
    notifications: items,
    unreadCount: unreadCount(items),
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  };
}
