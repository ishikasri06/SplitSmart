import test from "node:test";
import assert from "node:assert/strict";
import {
  canViewNotification,
  dedupeNotifications,
  formatRelativeTime,
  mapNotificationRow,
  notificationDedupeKey,
  selectNotificationRecipients,
  unreadCount,
} from "../src/notifications.js";

test("unreadCount counts only unread notifications", () => {
  assert.equal(unreadCount([{ readAt: null }, { readAt: "2026-01-01T00:00:00Z" }, {}]), 2);
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount(null), 0);
});

test("canViewNotification restricts a notification to its recipient", () => {
  const notification = { userId: "u1" };
  assert.equal(canViewNotification(notification, "u1"), true);
  assert.equal(canViewNotification(notification, "u2"), false);
  assert.equal(canViewNotification(null, "u1"), false);
});

test("selectNotificationRecipients excludes the actor and respects preferences", () => {
  const members = [{ id: "u1" }, { id: "u2" }, { id: "u3" }];

  const recipients = selectNotificationRecipients(members, {
    actorId: "u1",
    wantsNotifications: (id) => id !== "u3",
  });

  assert.deepEqual(recipients, ["u2"]);
});

test("notificationDedupeKey and dedupeNotifications collapse duplicate events", () => {
  const first = { type: "expense_created", entityId: "e1", id: "n1" };
  const duplicate = { type: "expense_created", entityId: "e1", id: "n2" };
  const other = { type: "expense_created", entityId: "e2", id: "n3" };

  assert.equal(notificationDedupeKey(first), "expense_created:e1");
  assert.equal(notificationDedupeKey({ type: "x", entityId: null }), null);
  assert.deepEqual(
    dedupeNotifications([first, duplicate, other]).map((item) => item.id),
    ["n1", "n3"]
  );
});

test("mapNotificationRow normalizes amounts, names and timestamps", () => {
  const mapped = mapNotificationRow({
    id: "n1",
    user_id: "u1",
    type: "settlement_recorded",
    title: "Settlement recorded",
    body: "Asha paid Ravi",
    amount: "50.00",
    group_name: "Goa trip",
    created_at: "2026-02-02T10:00:00Z",
  });

  assert.equal(mapped.amount, 50);
  assert.equal(mapped.groupName, "Goa trip");
  assert.equal(mapped.body, "Asha paid Ravi");
  assert.equal(typeof mapped.createdAt, "number");
  assert.equal(mapNotificationRow(null), null);
});

test("formatRelativeTime is human friendly", () => {
  const now = Date.parse("2026-02-02T10:00:00Z");

  assert.equal(formatRelativeTime(now - 30 * 1000, now), "just now");
  assert.equal(formatRelativeTime(now - 5 * 60 * 1000, now), "5m ago");
  assert.equal(formatRelativeTime(now - 3 * 3600 * 1000, now), "3h ago");
  assert.equal(formatRelativeTime(now - 2 * 86400 * 1000, now), "2d ago");
  assert.equal(formatRelativeTime(null, now), "");
  assert.equal(formatRelativeTime("not-a-date", now), "");
});
