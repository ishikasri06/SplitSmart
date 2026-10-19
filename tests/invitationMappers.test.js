import test from "node:test";
import assert from "node:assert/strict";
import {
  invitationStatusLabel,
  mapInvitationRow,
  mapMemberRow,
} from "../src/invitationMappers.js";

test("mapMemberRow normalizes member directory rows", () => {
  assert.deepEqual(
    mapMemberRow({ user_id: "u1", role: "owner", full_name: "Aarav", joined_at: "t0" }),
    { id: "u1", name: "Aarav", role: "owner", joinedAt: "t0" }
  );

  assert.deepEqual(mapMemberRow({ user_id: "u2" }), {
    id: "u2",
    name: "Member",
    role: "member",
    joinedAt: null,
  });
});

test("mapInvitationRow normalizes invitation rows and never exposes a token", () => {
  const mapped = mapInvitationRow({
    invitation_id: "i1",
    invited_email: "a@b.co",
    status: "pending",
    created_at: "t1",
    expires_at: "t2",
    accepted_at: null,
    token_hash: "should-not-appear",
  });

  assert.deepEqual(mapped, {
    id: "i1",
    email: "a@b.co",
    status: "pending",
    createdAt: "t1",
    expiresAt: "t2",
    acceptedAt: null,
  });
  assert.equal("token" in mapped, false);
  assert.equal("token_hash" in mapped, false);
});

test("mapInvitationRow defaults missing fields", () => {
  assert.deepEqual(mapInvitationRow({}), {
    id: undefined,
    email: "",
    status: "pending",
    createdAt: null,
    expiresAt: null,
    acceptedAt: null,
  });
});

test("invitationStatusLabel produces human labels", () => {
  assert.equal(invitationStatusLabel("pending"), "Pending");
  assert.equal(invitationStatusLabel("accepted"), "Accepted");
  assert.equal(invitationStatusLabel("revoked"), "Revoked");
  assert.equal(invitationStatusLabel("expired"), "Expired");
  assert.equal(invitationStatusLabel("weird"), "Unknown");
});
