import test from "node:test";
import assert from "node:assert/strict";
import {
  canChangeRoles,
  canManageInvitations,
  canRemoveMember,
  canRevokeInvitation,
  canSetRole,
  normalizeRole,
} from "../src/permissions.js";

test("normalizeRole maps owners and admins, defaults to member", () => {
  assert.equal(normalizeRole("owner"), "owner");
  assert.equal(normalizeRole("admin"), "admin");
  assert.equal(normalizeRole("member"), "member");
  assert.equal(normalizeRole(undefined), "member");
  assert.equal(normalizeRole("root"), "member");
});

test("only owners and admins can invite or revoke", () => {
  assert.equal(canManageInvitations("owner"), true);
  assert.equal(canManageInvitations("admin"), true);
  assert.equal(canManageInvitations("member"), false);
  assert.equal(canRevokeInvitation("admin"), true);
  assert.equal(canRevokeInvitation("member"), false);
});

test("only owners can change roles", () => {
  assert.equal(canChangeRoles("owner"), true);
  assert.equal(canChangeRoles("admin"), false);
  assert.equal(canChangeRoles("member"), false);
});

test("a member may leave but cannot remove others", () => {
  assert.equal(
    canRemoveMember({
      requesterRole: "member",
      targetRole: "member",
      ownerCount: 1,
      requesterId: "u1",
      targetId: "u1",
    }),
    true
  );

  assert.equal(
    canRemoveMember({
      requesterRole: "member",
      targetRole: "member",
      ownerCount: 1,
      requesterId: "u1",
      targetId: "u2",
    }),
    false
  );
});

test("the last owner cannot leave or be removed", () => {
  assert.equal(
    canRemoveMember({
      requesterRole: "owner",
      targetRole: "owner",
      ownerCount: 1,
      requesterId: "o1",
      targetId: "o1",
    }),
    false
  );

  assert.equal(
    canRemoveMember({
      requesterRole: "owner",
      targetRole: "owner",
      ownerCount: 2,
      requesterId: "o1",
      targetId: "o2",
    }),
    true
  );
});

test("an admin cannot remove an owner but an owner can", () => {
  assert.equal(
    canRemoveMember({
      requesterRole: "admin",
      targetRole: "owner",
      ownerCount: 2,
      requesterId: "a1",
      targetId: "o1",
    }),
    false
  );

  assert.equal(
    canRemoveMember({
      requesterRole: "owner",
      targetRole: "admin",
      ownerCount: 1,
      requesterId: "o1",
      targetId: "a1",
    }),
    true
  );
});

test("role changes require an owner and preserve the last owner", () => {
  assert.equal(
    canSetRole({ requesterRole: "admin", targetRole: "member", ownerCount: 1, nextRole: "owner" }),
    false
  );

  assert.equal(
    canSetRole({ requesterRole: "owner", targetRole: "member", ownerCount: 1, nextRole: "admin" }),
    true
  );

  assert.equal(
    canSetRole({ requesterRole: "owner", targetRole: "owner", ownerCount: 1, nextRole: "member" }),
    false
  );

  assert.equal(
    canSetRole({ requesterRole: "owner", targetRole: "owner", ownerCount: 2, nextRole: "member" }),
    true
  );

  assert.equal(
    canSetRole({ requesterRole: "owner", targetRole: "member", ownerCount: 1, nextRole: "root" }),
    false
  );
});
