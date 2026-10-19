export function mapMemberRow(row) {
  return {
    id: row.user_id,
    name: row.full_name || "Member",
    role: row.role || "member",
    joinedAt: row.joined_at || null,
  };
}

export function mapInvitationRow(row) {
  return {
    id: row.invitation_id,
    email: row.invited_email || "",
    status: row.status || "pending",
    createdAt: row.created_at || null,
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
  };
}

export function invitationStatusLabel(status) {
  switch (status) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    default:
      return "Unknown";
  }
}
