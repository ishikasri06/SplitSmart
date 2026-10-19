const PREFIX = "splitsmart:invite-link:";

function storage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    /* localStorage can throw in private mode or when disabled */
  }

  return null;
}

function key(groupId) {
  return `${PREFIX}${groupId}`;
}

export function saveGroupLinkToken(groupId, token) {
  const store = storage();
  if (!store || !groupId || !token) return;

  try {
    store.setItem(key(groupId), String(token));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function getGroupLinkToken(groupId) {
  const store = storage();
  if (!store || !groupId) return "";

  try {
    return store.getItem(key(groupId)) || "";
  } catch {
    return "";
  }
}

export function clearGroupLinkToken(groupId) {
  const store = storage();
  if (!store || !groupId) return;

  try {
    store.removeItem(key(groupId));
  } catch {
    /* ignore */
  }
}
