import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCES,
  mapPreferencesRow,
  normalizePreferences,
  preferencesToRow,
  validatePreferences,
  isSupportedSplitMethod,
  isSupportedReminderLead,
  isSupportedCurrency,
} from "../src/preferences.js";

test("defaults are INR, equal split, notifications on, 3-day reminder, system theme", () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    currency: "INR",
    defaultSplitMethod: "equal",
    notifyRecurringBills: true,
    notifyInvitations: true,
    notifyActivity: true,
    reminderLeadDays: 3,
    themeMode: "system",
  });
});

test("mapPreferencesRow returns defaults for a missing row", () => {
  assert.equal(mapPreferencesRow(null), DEFAULT_PREFERENCES);
  assert.equal(mapPreferencesRow(undefined), DEFAULT_PREFERENCES);
});

test("mapPreferencesRow maps a valid database row", () => {
  const mapped = mapPreferencesRow({
    user_id: "u1",
    currency: "INR",
    default_split_method: "percentage",
    notify_recurring_bills: false,
    notify_invitations: true,
    notify_activity: false,
    reminder_lead_days: 7,
  });

  assert.deepEqual(mapped, {
    currency: "INR",
    defaultSplitMethod: "percentage",
    notifyRecurringBills: false,
    notifyInvitations: true,
    notifyActivity: false,
    reminderLeadDays: 7,
    themeMode: "system",
  });
});

test("mapPreferencesRow coerces unsupported values back to safe defaults", () => {
  const mapped = mapPreferencesRow({
    currency: "USD",
    default_split_method: "weighted",
    reminder_lead_days: 14,
    notify_activity: null,
  });

  assert.equal(mapped.currency, "INR");
  assert.equal(mapped.defaultSplitMethod, "equal");
  assert.equal(mapped.reminderLeadDays, 3);
  // nullish notification flags keep the default (true), not undefined.
  assert.equal(mapped.notifyActivity, true);
});

test("normalizePreferences coerces garbage and preserves booleans", () => {
  const normalized = normalizePreferences({
    currency: "EUR",
    defaultSplitMethod: "exact",
    notifyRecurringBills: false,
    reminderLeadDays: "1",
  });

  assert.equal(normalized.currency, "INR");
  assert.equal(normalized.defaultSplitMethod, "exact");
  assert.equal(normalized.notifyRecurringBills, false);
  assert.equal(normalized.reminderLeadDays, 1);
});

test("validatePreferences throws for explicitly unsupported input", () => {
  assert.throws(() => validatePreferences({ currency: "USD" }), /Only INR is currently supported/);
  assert.throws(
    () => validatePreferences({ defaultSplitMethod: "weighted" }),
    /supported default split method/
  );
  assert.throws(
    () => validatePreferences({ reminderLeadDays: 14 }),
    /supported reminder lead time/
  );

  assert.doesNotThrow(() => validatePreferences(DEFAULT_PREFERENCES));
});

test("preferencesToRow produces the snake_case database shape", () => {
  const row = preferencesToRow("u1", {
    currency: "INR",
    defaultSplitMethod: "percentage",
    notifyRecurringBills: false,
    notifyInvitations: false,
    notifyActivity: true,
    reminderLeadDays: 1,
  });

  assert.deepEqual(row, {
    user_id: "u1",
    currency: "INR",
    default_split_method: "percentage",
    notify_recurring_bills: false,
    notify_invitations: false,
    notify_activity: true,
    reminder_lead_days: 1,
    theme_mode: "system",
  });
});

test("preferencesToRow requires a signed-in user id", () => {
  assert.throws(() => preferencesToRow("", DEFAULT_PREFERENCES), /signed in/);
  assert.throws(() => preferencesToRow(null, DEFAULT_PREFERENCES), /signed in/);
});

test("helper predicates recognise supported values", () => {
  assert.equal(isSupportedSplitMethod("equal"), true);
  assert.equal(isSupportedSplitMethod("exact"), true);
  assert.equal(isSupportedSplitMethod("percentage"), true);
  assert.equal(isSupportedSplitMethod("custom"), false);

  assert.equal(isSupportedReminderLead(1), true);
  assert.equal(isSupportedReminderLead("7"), true);
  assert.equal(isSupportedReminderLead(2), false);

  assert.equal(isSupportedCurrency("INR"), true);
  assert.equal(isSupportedCurrency("USD"), false);
});
