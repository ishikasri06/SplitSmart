// Pure helpers for in-app notifications. Kept free of React/Supabase imports so
// they can be unit-tested in Node and mirrored by the SQL triggers.
export const NOTIFICATION_TYPES = [
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "settlement_recorded",
  "invitation_received",
];

const TONES = {
  expense_created: "mint",
  expense_updated: "blue",
  expense_deleted: "pink",
  settlement_recorded: "lavender",
  invitation_received: "peach",
};

export function isNotificationType(type) {
  return NOTIFICATION_TYPES.includes(type);
}

export function notificationTone(type) {
  return TONES[type] || "lavender";
}

export function mapNotificationRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    actorId: row.actor_id || null,
    actorName: row.actor_name || "",
    groupId: row.group_id || null,
    groupName: row.group_name || "",
    title: row.title || "Update",
    body: row.body || "",
    amount: row.amount == null ? null : Number(row.amount),
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    readAt: row.read_at || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
  };
}

export function isUnread(notification) {
  return Boolean(notification) && !notification.readAt;
}

export function unreadCount(list = []) {
  return (Array.isArray(list) ? list : []).filter(isUnread).length;
}

export function sortNotifications(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
}

export function notificationDedupeKey(notification) {
  return notification?.entityId ? `${notification.type}:${notification.entityId}` : null;
}

// Collapses duplicate events for the same entity, keeping the first seen. Mirrors
// the database's unique (user_id, dedupe_key) constraint.
export function dedupeNotifications(list = []) {
  const seen = new Set();
  const result = [];

  for (const notification of Array.isArray(list) ? list : []) {
    const key = notificationDedupeKey(notification);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(notification);
  }

  return result;
}

// A recipient can only ever read their own notifications. Used as a defensive
// check on top of row-level security.
export function canViewNotification(notification, userId) {
  return Boolean(notification) && notification.userId === userId;
}

// Models the fan-out rules enforced inside public.notify_group_activity: every
// group member except the actor, and only those who kept the matching
// preference enabled.
export function selectNotificationRecipients(members = [], { actorId = null, wantsNotifications = () => true } = {}) {
  return (Array.isArray(members) ? members : [])
    .map((member) => (typeof member === "string" ? member : member?.id))
    .filter((id) => Boolean(id) && id !== actorId && wantsNotifications(id));
}

export function formatRelativeTime(value, now = Date.now()) {
  if (value == null || value === "") return "";

  const time = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(time)) return "";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const diff = Math.max(0, now - time);

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
