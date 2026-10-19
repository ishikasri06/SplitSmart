import { normalizeThemeMode } from "./theme.js";

export const DEFAULT_PREFERENCES = Object.freeze({
  currency: "INR",
  defaultSplitMethod: "equal",
  notifyRecurringBills: true,
  notifyInvitations: true,
  notifyActivity: true,
  reminderLeadDays: 3,
  themeMode: "system",
});

export const SPLIT_METHODS = ["equal", "exact", "percentage"];

export const SPLIT_METHOD_LABELS = {
  equal: "Equal split",
  exact: "Exact amounts",
  percentage: "Percentage",
};

// Only INR is supported: every amount is stored and computed in rupees and the
// schema has no per-expense currency conversion.
export const SUPPORTED_CURRENCIES = ["INR"];

export const REMINDER_LEAD_DAYS = [1, 3, 7];

export function isSupportedSplitMethod(method) {
  return SPLIT_METHODS.includes(method);
}

export function isSupportedReminderLead(days) {
  return REMINDER_LEAD_DAYS.includes(Number(days));
}

export function isSupportedCurrency(currency) {
  return SUPPORTED_CURRENCIES.includes(currency);
}

// Coerce a database row (snake_case) into a safe camelCase preferences object,
// falling back to defaults for anything missing or unexpected.
export function mapPreferencesRow(row) {
  if (!row) return DEFAULT_PREFERENCES;

  return {
    currency: isSupportedCurrency(row.currency) ? row.currency : DEFAULT_PREFERENCES.currency,
    defaultSplitMethod: isSupportedSplitMethod(row.default_split_method)
      ? row.default_split_method
      : DEFAULT_PREFERENCES.defaultSplitMethod,
    notifyRecurringBills:
      row.notify_recurring_bills ?? DEFAULT_PREFERENCES.notifyRecurringBills,
    notifyInvitations: row.notify_invitations ?? DEFAULT_PREFERENCES.notifyInvitations,
    notifyActivity: row.notify_activity ?? DEFAULT_PREFERENCES.notifyActivity,
    reminderLeadDays: isSupportedReminderLead(row.reminder_lead_days)
      ? Number(row.reminder_lead_days)
      : DEFAULT_PREFERENCES.reminderLeadDays,
    themeMode: normalizeThemeMode(row.theme_mode),
  };
}

// Normalize arbitrary input into a valid preferences object, coercing anything
// unsupported back to a safe default.
export function normalizePreferences(input = {}) {
  const merged = { ...DEFAULT_PREFERENCES, ...input };

  return {
    currency: isSupportedCurrency(merged.currency)
      ? merged.currency
      : DEFAULT_PREFERENCES.currency,
    defaultSplitMethod: isSupportedSplitMethod(merged.defaultSplitMethod)
      ? merged.defaultSplitMethod
      : DEFAULT_PREFERENCES.defaultSplitMethod,
    notifyRecurringBills: Boolean(merged.notifyRecurringBills),
    notifyInvitations: Boolean(merged.notifyInvitations),
    notifyActivity: Boolean(merged.notifyActivity),
    reminderLeadDays: isSupportedReminderLead(merged.reminderLeadDays)
      ? Number(merged.reminderLeadDays)
      : DEFAULT_PREFERENCES.reminderLeadDays,
    themeMode: normalizeThemeMode(merged.themeMode),
  };
}

// Strict validation used before writing to Supabase. Throws on input that is
// explicitly unsupported rather than silently coercing it.
export function validatePreferences(input = {}) {
  if (input.currency !== undefined && !isSupportedCurrency(input.currency)) {
    throw new Error("Only INR is currently supported.");
  }

  if (
    input.defaultSplitMethod !== undefined &&
    !isSupportedSplitMethod(input.defaultSplitMethod)
  ) {
    throw new Error("Choose a supported default split method.");
  }

  if (input.reminderLeadDays !== undefined && !isSupportedReminderLead(input.reminderLeadDays)) {
    throw new Error("Choose a supported reminder lead time.");
  }

  return normalizePreferences(input);
}

export function preferencesToRow(userId, input = {}) {
  if (!userId) {
    throw new Error("You must be signed in to save preferences.");
  }

  const preferences = validatePreferences(input);

  return {
    user_id: userId,
    currency: preferences.currency,
    default_split_method: preferences.defaultSplitMethod,
    notify_recurring_bills: preferences.notifyRecurringBills,
    notify_invitations: preferences.notifyInvitations,
    notify_activity: preferences.notifyActivity,
    reminder_lead_days: preferences.reminderLeadDays,
    theme_mode: preferences.themeMode,
  };
}
