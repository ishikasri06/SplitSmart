export function normalizeRole(role) {
  return role === "owner" || role === "admin" ? role : "member";
}

export function isOwnerRole(role) {
  return normalizeRole(role) === "owner";
}

export function isManagerRole(role) {
  const value = normalizeRole(role);
  return value === "owner" || value === "admin";
}

export function canManageInvitations(role) {
  return isManagerRole(role);
}

export function canManageMembers(role) {
  return isManagerRole(role);
}

export function canRevokeInvitation(role) {
  return isManagerRole(role);
}

export function canChangeRoles(role) {
  return isOwnerRole(role);
}

export function canRemoveMember({
  requesterRole,
  targetRole,
  ownerCount,
  requesterId,
  targetId,
} = {}) {
  const requester = normalizeRole(requesterRole);
  const target = normalizeRole(targetRole);
  const owners = Number(ownerCount) || 0;

  if (requesterId && targetId && requesterId === targetId) {
    return target === "owner" ? owners > 1 : true;
  }

  if (!isManagerRole(requester)) return false;

  if (target === "owner") {
    return isOwnerRole(requester) && owners > 1;
  }

  return true;
}

export function canSetRole({
  requesterRole,
  targetRole,
  ownerCount,
  nextRole,
} = {}) {
  if (!isOwnerRole(requesterRole)) return false;
  if (!["owner", "admin", "member"].includes(nextRole)) return false;

  if (normalizeRole(targetRole) === "owner" && nextRole !== "owner") {
    return (Number(ownerCount) || 0) > 1;
  }

  return true;
}
