import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveProfileName,
  getProfileDisplayName,
  getUserInitials,
} from "../src/profileUtils.js";

test("display name prefers the profile full name", () => {
  const user = { email: "jane@example.com", user_metadata: { full_name: "Meta Name" } };
  assert.equal(getProfileDisplayName(user, { full_name: "Profile Name" }), "Profile Name");
});

test("display name falls back to auth metadata when the profile is missing", () => {
  const user = { email: "jane@example.com", user_metadata: { full_name: "Meta Name" } };
  assert.equal(getProfileDisplayName(user, null), "Meta Name");
  assert.equal(getProfileDisplayName(user, { full_name: "   " }), "Meta Name");
});

test("display name falls back to the email username", () => {
  const user = { email: "jane.doe@example.com" };
  assert.equal(getProfileDisplayName(user, null), "jane.doe");
  assert.equal(getProfileDisplayName(user, { full_name: "" }), "jane.doe");
});

test("display name never leaks another account's name", () => {
  const alice = { id: "a", email: "alice@example.com", user_metadata: { full_name: "Alice" } };
  const bob = { id: "b", email: "bob@example.com", user_metadata: { full_name: "Bob" } };
  assert.equal(getProfileDisplayName(alice, { full_name: "Alice" }), "Alice");
  assert.equal(getProfileDisplayName(bob, { full_name: "Bob" }), "Bob");
});

test("display name has a safe final fallback", () => {
  assert.equal(getProfileDisplayName(null, null), "User");
  assert.equal(getProfileDisplayName({}, null), "User");
});

test("initials are derived from the profile name", () => {
  const user = { email: "jane@example.com" };
  assert.equal(getUserInitials(user, { full_name: "Ishika Srivastava" }), "IS");
  assert.equal(getUserInitials(user, { full_name: "Meera" }), "M");
});

test("initials fall back to the email when no name exists", () => {
  assert.equal(getUserInitials({ email: "john.doe@example.com" }, null), "JD");
  assert.equal(getUserInitials({ email: "sam@example.com" }, { full_name: "" }), "S");
});

test("initials never return an empty string", () => {
  assert.equal(getUserInitials(null, null), "U");
});

// deriveProfileName() must match what public.handle_new_user() writes at signup
// (raw_user_meta_data.full_name, else the email local part), because it is used
// to rebuild a public.profiles row that was deleted.
test("derive name prefers signup metadata, like handle_new_user", () => {
  assert.equal(
    deriveProfileName({ email: "jane@example.com", user_metadata: { full_name: "Jane Doe" } }),
    "Jane Doe"
  );
});

test("derive name falls back to the email local part when metadata is absent", () => {
  assert.equal(deriveProfileName({ email: "jane@example.com" }), "jane");
  assert.equal(
    deriveProfileName({ email: "jane@example.com", user_metadata: { full_name: "   " } }),
    "jane"
  );
});

test("derive name keeps the trimmed metadata value", () => {
  assert.equal(
    deriveProfileName({ email: "jane@example.com", user_metadata: { full_name: "  Jane  " } }),
    "Jane"
  );
});

test("derive name returns null when there is nothing to fall back on", () => {
  assert.equal(deriveProfileName({ email: "" }), null);
  assert.equal(deriveProfileName({}), null);
  assert.equal(deriveProfileName(null), null);
  assert.equal(deriveProfileName({ user_metadata: {} }), null);
});
