export function normalizeEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email) {
  return EMAIL_PATTERN.test(String(email ?? "").trim());
}

export function getInviteToken(location) {
  if (!location) return "";

  try {
    const params = new URLSearchParams(location.search || "");
    const fromQuery = params.get("invite");

    if (fromQuery && fromQuery.trim()) {
      return fromQuery.trim();
    }

    const match = String(location.pathname || "").match(/\/join\/([^/?#]+)/);

    if (match && match[1]) {
      return decodeURIComponent(match[1]).trim();
    }
  } catch {
    return "";
  }

  return "";
}

export function buildInviteUrl(origin, token) {
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/?invite=${encodeURIComponent(token)}`;
}

export function clearInviteParam() {
  if (typeof window === "undefined" || !window.history) return;

  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    /* no-op: leaving the token in the URL is harmless on failure */
  }
}
