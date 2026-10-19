function firstNonEmptyName(...names) {
  return names.find((name) => typeof name === "string" && name.trim())?.trim();
}

export function getProfileDisplayName(authUser, profile) {
  return (
    firstNonEmptyName(profile?.full_name, authUser?.user_metadata?.full_name) ||
    authUser?.email?.split("@")[0] ||
    "User"
  );
}

// Mirrors the name public.handle_new_user() writes at signup:
// raw_user_meta_data.full_name, else the email local part, else nothing
// (public.profiles.full_name is nullable, so null means "insert the id only").
// Used when the profile row has to be rebuilt by the app.
export function deriveProfileName(authUser) {
  const metaName = firstNonEmptyName(authUser?.user_metadata?.full_name);
  if (metaName) return metaName;

  const email = typeof authUser?.email === "string" ? authUser.email : "";
  return email.split("@")[0]?.trim() || null;
}

export function getUserInitials(authUser, profile) {
  const displayName = getProfileDisplayName(authUser, profile);
  const source =
    displayName !== "User" ? displayName : authUser?.email || displayName;

  const letters = String(source)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return letters || "U";
}
