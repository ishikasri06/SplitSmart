import test from "node:test";
import assert from "node:assert/strict";
import { validateEmail, validateSignup } from "../src/authValidation.js";

test("validateEmail trims, accepts real emails and rejects malformed input", () => {
  assert.equal(validateEmail("  User@Example.com  "), "User@Example.com");
  assert.equal(validateEmail("a@b.co"), "a@b.co");

  assert.throws(() => validateEmail(""), /Enter your email address/);
  assert.throws(() => validateEmail("   "), /Enter your email address/);
  assert.throws(() => validateEmail(null), /Enter your email address/);
  assert.throws(() => validateEmail("not-an-email"), /valid email address/);
  assert.throws(() => validateEmail("a@b"), /valid email address/);
  assert.throws(() => validateEmail("a b@c.com"), /valid email address/);
});

test("validateSignup returns normalized email and accepted password", () => {
  const result = validateSignup({
    email: "  new@user.com ",
    password: "abcdefg1",
    confirm: "abcdefg1",
  });

  assert.deepEqual(result, { email: "new@user.com", password: "abcdefg1" });
});

test("validateSignup enforces email format", () => {
  assert.throws(
    () => validateSignup({ email: "bad", password: "abcdefg1", confirm: "abcdefg1" }),
    /valid email address/
  );
});

test("validateSignup enforces password strength", () => {
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "short", confirm: "short" }),
    /at least 8 characters/
  );
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "abcdefgh", confirm: "abcdefgh" }),
    /at least one number/
  );
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "12345678", confirm: "12345678" }),
    /at least one letter/
  );
});

test("validateSignup requires matching passwords", () => {
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "abcdefg1", confirm: "abcdefg2" }),
    /do not match/
  );
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "abcdefg1", confirm: "" }),
    /do not match/
  );
});

test("validateSignup requires a password", () => {
  assert.throws(
    () => validateSignup({ email: "a@b.co", password: "", confirm: "" }),
    /Enter a new password/
  );
});
