import { useEffect, useState, cloneElement } from "react";
import { supabase } from "./supabase";
import { getInviteToken } from "./inviteUtils";
import { previewInvitation } from "./invitations";
import { validateSignup } from "./authValidation";
import { MIN_PASSWORD_LENGTH } from "./password";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState("info");
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setMessage(error.message);
        setMessageKind("error");
      }
      setSession(data?.session ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const token = getInviteToken(
      typeof window !== "undefined" ? window.location : null
    );

    if (!token) return undefined;

    previewInvitation(token)
      .then((preview) => {
        if (active) setInvitePreview(preview || { invalid: true });
      })
      .catch(() => {
        if (active) setInvitePreview({ invalid: true });
      });

    return () => {
      active = false;
    };
  }, []);

  function showMessage(text, kind = "info") {
    setMessage(text);
    setMessageKind(kind);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setBusy(true);

    try {
      if (isSignup) {
        // Validate email format, password strength, and matching passwords
        // before calling Supabase.
        const { email: validEmail, password: validPassword } = validateSignup({
          email,
          password,
          confirm,
        });

        // Email confirmation is disabled for this dev phase in the Supabase
        // Dashboard (Authentication → Providers → Email → "Confirm email" off),
        // so no `emailRedirectTo` is passed and no OTP is requested. When
        // confirmation is off Supabase returns a session immediately; we still
        // handle the confirmation-on case below instead of pretending success.
        const { data, error } = await supabase.auth.signUp({
          email: validEmail,
          password: validPassword,
        });

        if (error) throw error;

        if (data.session) {
          // A valid session was returned: onAuthStateChange takes the user
          // into the app.
          showMessage("Account created. Welcome to SplitSmart!", "success");
        } else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          // Supabase returns a user with no identities when the email is already
          // registered, to avoid leaking which emails exist.
          showMessage(
            "An account may already exist for this email. Try logging in instead.",
            "error"
          );
        } else {
          // Email confirmation is still enabled on the project: be honest about
          // it instead of implying the user is signed in.
          showMessage(
            "Account created, but email confirmation is still required. Disable \"Confirm email\" in Supabase (Authentication → Providers → Email) for this dev phase, or confirm via the email we sent and then log in.",
            "info"
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;
      }
    } catch (error) {
      showMessage(error.message || "Authentication failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  const styles = {
    page: {
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: 24,
      background: "#f7f5ff",
      fontFamily: "Inter, system-ui, sans-serif",
      color: "#29243c",
    },
    card: {
      width: "100%",
      maxWidth: 420,
      background: "#fff",
      border: "1px solid #e9e4f5",
      borderRadius: 20,
      padding: 30,
      boxShadow: "0 16px 45px rgba(60, 40, 100, .08)",
    },
    input: {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      padding: 12,
      marginTop: 7,
      border: "1px solid #ddd6ed",
      borderRadius: 9,
      fontSize: 15,
    },
    hint: {
      display: "block",
      marginTop: 6,
      color: "#8b86a0",
      fontSize: 12,
      lineHeight: 1.5,
    },
    button: {
      width: "100%",
      padding: 13,
      marginTop: 18,
      border: 0,
      borderRadius: 9,
      background: "#7560ce",
      color: "#fff",
      fontSize: 15,
      fontWeight: 600,
      cursor: "pointer",
    },
  };

  if (loading) {
    return <div style={styles.page}>Loading SplitSmart...</div>;
  }

  if (session) {
    return (
      <>
        {children &&
          cloneElement(children, {
            authUser: session.user,
            onLogout: handleLogout,
          })}
      </>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={{ fontSize: 13, color: "#7560ce", fontWeight: 700 }}>
          SPLITSMART
        </div>

        {invitePreview && (
          <div
            style={{
              marginTop: 14,
              background: "#f4f1ff",
              border: "1px solid #e5dffa",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#5b4fa0",
            }}
          >
            {invitePreview.invalid || !invitePreview.group_name ? (
              "You opened an invitation link. Sign in or create an account to continue."
            ) : invitePreview.status === "revoked" || invitePreview.status === "expired" || invitePreview.status === "accepted" ? (
              "This invitation is no longer available."
            ) : (
              <>
                You&apos;ve been invited to join{" "}
                <b>{invitePreview.group_name}</b>
                {invitePreview.kind === "link" ? " via a share link" : ""}. Sign
                in or create an account to accept.
              </>
            )}
          </div>
        )}

        <h1 style={{ marginBottom: 8 }}>
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>

        <p style={{ color: "#777187", lineHeight: 1.6 }}>
          {isSignup
            ? "Create an account to get started."
            : "Log in to continue to SplitSmart."}
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block" }}>
            Email
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label style={{ display: "block", marginTop: 16 }}>
            Password
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={isSignup ? MIN_PASSWORD_LENGTH : 6}
              required
            />
            {isSignup && (
              <small style={styles.hint}>
                At least {MIN_PASSWORD_LENGTH} characters, including a letter and a
                number.
              </small>
            )}
          </label>

          {isSignup && (
            <label style={{ display: "block", marginTop: 16 }}>
              Confirm password
              <input
                style={styles.input}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
          )}

          {message && (
            <p
              role={messageKind === "error" ? "alert" : "status"}
              style={{
                marginTop: 14,
                color:
                  messageKind === "error"
                    ? "#b23b3b"
                    : messageKind === "success"
                      ? "#1f7a5a"
                      : "#6550a8",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {message}
            </p>
          )}

          <button style={styles.button} disabled={busy} type="submit">
            {busy
              ? "Please wait..."
              : isSignup
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: "center", fontSize: 14 }}>
          {isSignup ? "Already have an account?" : "New to SplitSmart?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsSignup((value) => !value);
              setMessage("");
              setConfirm("");
            }}
            style={{
              border: 0,
              background: "none",
              color: "#7560ce",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
      </section>
    </main>
  );
}
