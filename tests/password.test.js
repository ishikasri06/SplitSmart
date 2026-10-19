import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_STRENGTH_LABELS,
  passwordProblems,
  passwordStrength,
  passwordStrengthLabel,
  validatePasswordChange,
} from "../src/password.js";

test("MIN_PASSWORD_LENGTH is a sane minimum", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(PASSWORD_STRENGTH_LABELS.length, 5);
});

test("passwordStrength scores from 0 to 4", () => {
  assert.equal(passwordStrength(""), 0);
  assert.equal(passwordStrength("short"), 0);

  const weak = passwordStrength("abcdefgh");
  const strong = passwordStrength("Abcdefgh1!");
  assert.ok(strong > weak);
  assert.equal(strong, 4);

  assert.ok(passwordStrength("a".repeat(40)) <= 4);
});

test("passwordStrengthLabel returns a human label for each score", () => {
  assert.equal(passwordStrengthLabel(""), "Too weak");
  assert.equal(passwordStrengthLabel("Abcdefgh1!"), "Strong");
});

test("passwordProblems lists every failing rule at once", () => {
  assert.deepEqual(passwordProblems("Abcdefg1"), []);

  const problems = passwordProblems("abc");
  assert.equal(problems.length, 2);
  assert.match(problems.join(" "), /at least 8 characters/);
  assert.match(problems.join(" "), /at least one number/);

  const noLetter = passwordProblems("12345678");
  assert.ok(noLetter.some((p) => /letter/.test(p)));
});

test("validatePasswordChange rejects empty, weak and mismatched input", () => {
  assert.throws(() => validatePasswordChange({}), /Enter a new password/);
  assert.throws(
    () => validatePasswordChange({ password: "abc", confirm: "abc" }),
    /at least 8 characters/
  );
  assert.throws(
    () => validatePasswordChange({ password: "abcdefgh", confirm: "abcdefgh" }),
    /at least one number/
  );
  assert.throws(
    () => validatePasswordChange({ password: "abcdefg1", confirm: "abcdefg2" }),
    /do not match/
  );
});

test("validatePasswordChange returns the accepted password", () => {
  assert.equal(validatePasswordChange({ password: "abcdefg1", confirm: "abcdefg1" }), "abcdefg1");
});
