// Password-change validation. Pure and side-effect free so it can be unit
// tested. Passwords are never persisted or logged anywhere in the app.

export const MIN_PASSWORD_LENGTH = 8;

// A small, transparent strength score (0..4) used purely for UI feedback.
export function passwordStrength(password) {
  const value = String(password || "");
  if (!value) return 0;

  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  return Math.min(score, 4);
}

export const PASSWORD_STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function passwordStrengthLabel(password) {
  return PASSWORD_STRENGTH_LABELS[passwordStrength(password)];
}

// Returns an array of human-readable problems. Empty means the password is
// acceptable. Kept as a list so the UI can show every issue at once.
export function passwordProblems(password) {
  const value = String(password || "");
  const problems = [];

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!/[A-Za-z]/.test(value)) {
    problems.push("Include at least one letter.");
  }
  if (!/\d/.test(value)) {
    problems.push("Include at least one number.");
  }

  return problems;
}

// Validates a change-password submission. Throws on the first problem so the
// caller can surface a single clear message.
export function validatePasswordChange({ password, confirm } = {}) {
  const next = String(password || "");
  const again = String(confirm || "");

  if (!next) {
    throw new Error("Enter a new password.");
  }

  const problems = passwordProblems(next);
  if (problems.length) {
    throw new Error(problems[0]);
  }

  if (next !== again) {
    throw new Error("The two passwords do not match.");
  }

  return next;
}
