// Signup/login input validation shared by the auth screen. Pure and
// side-effect free so it can be unit tested. No credentials are ever stored or
// logged here.

import { isValidEmail } from "./inviteUtils.js";
import { validatePasswordChange } from "./password.js";

// Normalizes and validates an email address for signup. Throws a clear,
// user-facing Error when it is missing or malformed.
export function validateEmail(email) {
  const value = String(email ?? "").trim();

  if (!value) {
    throw new Error("Enter your email address.");
  }

  if (!isValidEmail(value)) {
    throw new Error("Enter a valid email address.");
  }

  return value;
}

// Validates a signup submission: email format, password strength, and that the
// two passwords match. Password strength rules live in `password.js`
// (`validatePasswordChange`), so signup and change-password stay consistent.
// Returns the normalized email and accepted password.
export function validateSignup({ email, password, confirm } = {}) {
  const normalizedEmail = validateEmail(email);
  const acceptedPassword = validatePasswordChange({ password, confirm });
  return { email: normalizedEmail, password: acceptedPassword };
}
