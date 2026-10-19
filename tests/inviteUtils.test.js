import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInviteUrl,
  getInviteToken,
  isValidEmail,
  normalizeEmail,
} from "../src/inviteUtils.js";

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Friend@Example.COM "), "friend@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("isValidEmail accepts real emails and rejects malformed input", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("  a@b.co  "), true);
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(isValidEmail("bad@domain"), false);
  assert.equal(isValidEmail("a b@c.com"), false);
  assert.equal(isValidEmail(""), false);
});

test("getInviteToken reads the invite query parameter", () => {
  assert.equal(
    getInviteToken({ search: "?invite=abc123", pathname: "/" }),
    "abc123"
  );
  assert.equal(getInviteToken({ search: "?invite=  xyz  ", pathname: "/" }), "xyz");
  assert.equal(getInviteToken({ search: "", pathname: "/" }), "");
  assert.equal(getInviteToken(null), "");
});

test("getInviteToken supports the legacy /join/<token> path", () => {
  assert.equal(getInviteToken({ search: "", pathname: "/join/tok-9" }), "tok-9");
  assert.equal(
    getInviteToken({ search: "", pathname: "/join/a%20b" }),
    "a b"
  );
});

test("getInviteToken prefers the query parameter over the path", () => {
  assert.equal(
    getInviteToken({ search: "?invite=query", pathname: "/join/path" }),
    "query"
  );
});

test("buildInviteUrl encodes the token onto the origin root", () => {
  assert.equal(
    buildInviteUrl("https://app.example.com/", "a b/c"),
    "https://app.example.com/?invite=a%20b%2Fc"
  );
  assert.equal(buildInviteUrl("https://x.io", "abc"), "https://x.io/?invite=abc");
});
