import { supabase } from "./supabase";

function raise(error, fallback) {
  if (error) {
    throw new Error(error.message || fallback);
  }
}

export async function previewInvitation(token) {
  const { data, error } = await supabase.rpc("get_invite_preview", {
    p_token: token,
  });

  raise(error, "Could not load this invitation.");

  return (data && data[0]) || null;
}

export async function createInvitation(groupId, email) {
  const { data, error } = await supabase.rpc("create_group_invitation", {
    p_group_id: groupId,
    p_email: email,
  });

  raise(error, "Could not create the invitation.");

  const row = data && data[0];

  if (!row) return null;

  return {
    id: row.invitation_id,
    token: row.token,
    expiresAt: row.expires_at,
  };
}

export async function listInvitations(groupId) {
  const { data, error } = await supabase.rpc("list_group_invitations", {
    p_group_id: groupId,
  });

  raise(error, "Could not load invitations.");

  return data || [];
}

export async function revokeInvitation(invitationId) {
  const { error } = await supabase.rpc("revoke_group_invitation", {
    p_invitation_id: invitationId,
  });

  raise(error, "Could not revoke the invitation.");
}

export async function acceptInvitation(token) {
  const { data, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  });

  raise(error, "Could not accept the invitation.");

  return (data && data[0]) || null;
}

export async function createGroupInviteLink(groupId) {
  const { data, error } = await supabase.rpc("create_group_invite_link", {
    p_group_id: groupId,
  });

  raise(error, "Could not create the group invite link.");

  const row = data && data[0];

  if (!row) return null;

  return {
    id: row.link_id,
    token: row.token || "",
    expiresAt: row.expires_at,
    created: Boolean(row.created),
  };
}

export async function getGroupInviteLink(groupId) {
  const { data, error } = await supabase.rpc("get_group_invite_link", {
    p_group_id: groupId,
  });

  raise(error, "Could not load the group invite link.");

  const row = data && data[0];

  if (!row) return null;

  return {
    id: row.link_id,
    status: row.status || "active",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function revokeGroupInviteLink(groupId) {
  const { error } = await supabase.rpc("revoke_group_invite_link", {
    p_group_id: groupId,
  });

  raise(error, "Could not revoke the group invite link.");
}

export async function getGroupMemberBalance(groupId, userId) {
  const { data, error } = await supabase.rpc("group_member_net_balance", {
    p_group_id: groupId,
    p_user_id: userId,
  });

  raise(error, "Could not check the member's balance.");

  return Number(data ?? 0);
}

export async function removeGroupMember(groupId, userId) {
  const { error } = await supabase.rpc("remove_group_member", {
    p_group_id: groupId,
    p_user_id: userId,
  });

  raise(error, "Could not remove the member.");
}

export async function setGroupMemberRole(groupId, userId, role) {
  const { error } = await supabase.rpc("set_group_member_role", {
    p_group_id: groupId,
    p_user_id: userId,
    p_role: role,
  });

  raise(error, "Could not update the member role.");
}
