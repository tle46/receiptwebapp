import { useConfirmation } from "./ConfirmationDialog";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { auth, ApiError } from "./api";
import { session } from "./session";

type Mode =
  "login" | "register" | "profile" | "verify" | "forgot" | "reset" | "password";
type GoogleApi = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        callback: (result: { credential: string }) => void;
      }): void;
      renderButton(
        element: HTMLElement,
        options: { theme: string; size: string },
      ): void;
      cancel(): void;
    };
  };
};
let googleScript: Promise<void> | null = null;
function loadGoogle() {
  if (!googleScript)
    googleScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        googleScript = null;
        reject(new Error("Google sign-in could not load."));
      };
      document.head.appendChild(script);
    });
  return googleScript;
}
export default function AccountPanel({
  close,
  embedded = false,
  beforeSwitch = () => {},
}: {
  close?: () => void;
  embedded?: boolean;
  beforeSwitch?: () => void | Promise<void>;
}) {
  const { confirm, notify } = useConfirmation();
  const user = useSyncExternalStore(session.subscribe, session.get);
  const [mode, setMode] = useState<Mode>(
    user?.status === "ACTIVE" ? "profile" : "login",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const modal = useRef<HTMLElement>(null),
    googleButton = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement;
    if (!embedded)
      modal.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      alive.current = false;
      previous?.focus();
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    setFields({});
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Request failed.");
        setFields(e instanceof ApiError ? e.fields : {});
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const input = (
    name: string,
    label: string,
    type = "text",
    value?: string,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required
        defaultValue={value}
        maxLength={
          name === "token"
            ? 128
            : type === "password"
              ? 72
              : name === "displayName"
                ? 80
                : type === "email" || (name === "username" && mode === "login")
                  ? 254
                  : 32
        }
        minLength={
          type === "password" && name !== "currentPassword" && mode !== "login"
            ? 12
            : undefined
        }
        pattern={
          name === "username" && mode === "register"
            ? "[a-zA-Z0-9_]{3,32}"
            : undefined
        }
        autoComplete={
          type === "password"
            ? mode === "login" || name === "currentPassword"
              ? "current-password"
              : "new-password"
            : name === "username"
              ? "username"
              : type === "email"
                ? "email"
                : "off"
        }
      />
      {fields[name] && <small className="field-error">{fields[name]}</small>}
    </label>
  );
  async function switching() {
    await beforeSwitch();
    if (
      user?.status === "GUEST" &&
      !(await confirm(
        "Sign in to a separate account? Your guest receipts will not merge. Register instead to preserve this guest account.",
        {
          title: "Switch account?",
          confirmLabel: "Sign in",
          cancelLabel: "Keep guest account",
        },
      ))
    )
      throw new Error("Sign-in cancelled.");
  }
  async function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<
      string,
      string
    >;
    for (const key of ["password", "newPassword"])
      if (
        data[key] &&
        mode !== "login" &&
        new TextEncoder().encode(data[key]).length > 72
      )
        throw new Error("Password must be at most 72 UTF-8 bytes.");
    if (mode === "login" || mode === "register") {
      if (mode === "login") data.username = data.username.trim();
      if (mode === "login") await switching();
      else await beforeSwitch();
      const next = await (mode === "login"
        ? auth.login(data)
        : auth.register(data));
      session.set(next);
      if (mode === "register") {
        try {
          await auth.sendVerification();
        } catch {
          await notify(
            "Account created. Verification email is unavailable; resend from Account settings.",
            { title: "Account created", confirmLabel: "Got it" },
          );
        }
      }
      close?.();
    } else if (mode === "profile") {
      session.profile(await auth.profile(data.displayName));
      setNotice("Profile saved.");
    } else if (mode === "verify") {
      await auth.verify(data.token);
      if (session.get()) session.profile(await auth.me());
      setNotice("Email verified.");
    } else if (mode === "forgot") {
      await auth.forgot(data.email);
      setNotice(
        "If a verified password account exists, a reset token has been sent.",
      );
    } else if (mode === "reset") {
      await auth.reset(data);
      session.set(null);
      setMode("login");
      setNotice("Password reset. Sign in again.");
    } else {
      await beforeSwitch();
      await auth.changePassword(data);
      session.set(null);
      setMode("login");
      setNotice("Password changed. Sign in again.");
    }
  }
  const clientId = (import.meta as unknown as { env: Record<string, string> })
    .env.VITE_GOOGLE_CLIENT_ID;
  return (
    <div className={embedded ? "entry-account" : "modal-backdrop"}>
      <section
        ref={modal}
        className={embedded ? "account-panel" : "modal account-modal"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="identity-title"
        onKeyDown={(event) => {
          if (embedded) return;
          if (event.key === "Escape" && !busy) close?.();
          if (event.key !== "Tab") return;
          const controls = [
            ...(modal.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled)",
            ) || []),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {close && (
          <button
            className="modal-close"
            aria-label="Close account"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        )}
        <h1 id="identity-title">
          {mode === "profile"
            ? "Account settings"
            : mode === "register"
              ? "Create account"
              : mode === "login"
                ? "Sign in"
                : mode === "verify"
                  ? "Verify email"
                  : mode === "forgot"
                    ? "Recover password"
                    : mode === "reset"
                      ? "Reset password"
                      : "Change password"}
        </h1>
        {user?.status === "GUEST" && (
          <p>
            Register to keep access to your receipts if your guest session
            expires or this browser’s cookies are cleared.
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        <fieldset disabled={busy} className="account-fieldset">
          <div
            className="tabs account-primary-tabs"
            aria-label="Account options"
          >
            {(
              ["login", "register", ...(user ? ["profile"] : [])] as Mode[]
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={mode === tab}
                className={mode === tab ? "active" : ""}
                onClick={() => {
                  setMode(tab);
                  setError("");
                  setNotice("");
                }}
              >
                {tab === "login"
                  ? "Sign in"
                  : tab === "register"
                    ? "Register"
                    : "Profile"}
              </button>
            ))}
          </div>
          <form
            key={mode}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void run(() => submit(form));
            }}
          >
            {(mode === "login" || mode === "register") &&
              input(
                "username",
                mode === "login" ? "Username or email" : "Username",
              )}
            {(mode === "login" || mode === "register" || mode === "reset") &&
              input("password", "Password", "password")}
            {mode === "register" && input("email", "Email", "email")}
            {(mode === "register" || mode === "profile") &&
              input("displayName", "Display name", "text", user?.displayName)}
            {mode === "forgot" && input("email", "Email", "email")}
            {(mode === "verify" || mode === "reset") &&
              input("token", "Email token")}
            {mode === "password" && (
              <>
                {input("currentPassword", "Current password", "password")}
                {input("newPassword", "New password", "password")}
              </>
            )}
            <button className="primary" type="submit">
              {busy ? "Working…" : "Continue"}
            </button>
          </form>
          {(mode === "login" || mode === "register" || mode === "profile") && (
            <>
              <button
                disabled={!clientId}
                onClick={() =>
                  void run(async () => {
                    await beforeSwitch();
                    const linkAccount = mode !== "login" && !!session.get();
                    await loadGoogle();
                    const epoch = session.epoch();
                    const { nonce } = await auth.nonce(linkAccount);
                    if (!alive.current || epoch !== session.epoch()) return;
                    const google = (window as unknown as { google: GoogleApi })
                      .google;
                    google.accounts.id.initialize({
                      client_id: clientId,
                      nonce,
                      callback: (result) => {
                        if (!alive.current || epoch !== session.epoch()) return;
                        void run(async () => {
                          await beforeSwitch();
                          const next = await auth.google(
                            result.credential,
                            nonce,
                            linkAccount,
                          );
                          session.set(next);
                          close?.();
                        });
                      },
                    });
                    googleButton.current!.replaceChildren();
                    google.accounts.id.renderButton(googleButton.current!, {
                      theme: "outline",
                      size: "large",
                    });
                  })
                }
              >
                {mode === "login"
                  ? "Sign in with Google"
                  : user?.status === "ACTIVE"
                    ? "Link Google account"
                    : "Register with Google"}
              </button>
              {!clientId && (
                <small>Google sign-in is unavailable on this deployment.</small>
              )}
              <div ref={googleButton} />
            </>
          )}
          <nav className="account-help-links" aria-label="Account help">
            {(
              [
                "forgot",
                "verify",
                ...(mode === "forgot" || mode === "reset" ? ["reset"] : []),
                ...(user?.passwordEnabled ? ["password"] : []),
              ] as Mode[]
            ).map((tab) => (
              <button
                type="button"
                key={tab}
                aria-pressed={mode === tab}
                onClick={() => {
                  setMode(tab);
                  setError("");
                  setNotice("");
                }}
              >
                {
                  {
                    forgot: "Forgot password?",
                    verify: "Verify email",
                    reset: "Have a reset token?",
                    password: "Change password",
                    login: "",
                    register: "",
                    profile: "",
                  }[tab]
                }
              </button>
            ))}
          </nav>
          {user && mode === "profile" && (
            <div className="account-actions">
              <p>
                Username: <strong>{user.username}</strong>
              </p>
              <p>
                {user.email || "Guest account"} ·{" "}
                {user.emailVerified ? "Email verified" : "Email not verified"}
              </p>
              {user.email && !user.emailVerified && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await auth.sendVerification();
                      setNotice("Verification token sent.");
                    })
                  }
                >
                  Resend verification email
                </button>
              )}
              {[false, true].map((all) => (
                <button
                  key={String(all)}
                  onClick={() =>
                    void run(async () => {
                      await beforeSwitch();
                      if (
                        !(await confirm(
                          user.status === "GUEST"
                            ? "Sign out and lose access to this guest account?"
                            : all
                              ? "Sign out on all devices?"
                              : "Sign out?",
                          {
                            title: "Sign out?",
                            confirmLabel: all
                              ? "Sign out all devices"
                              : "Sign out",
                            cancelLabel: "Stay signed in",
                          },
                        ))
                      )
                        return;
                      await auth.logout(all);
                      session.set(null);
                    })
                  }
                >
                  {all ? "Sign out all devices" : "Sign out"}
                </button>
              ))}
              <button
                className="delete-button"
                onClick={() =>
                  void run(async () => {
                    await beforeSwitch();
                    if (
                      !(await confirm(
                        "Deactivate your account? Access will be disabled. Shared receipt records remain.",
                        {
                          title: "Deactivate account?",
                          confirmLabel: "Deactivate account",
                          danger: true,
                        },
                      ))
                    )
                      return;
                    await auth.deactivate();
                    session.set(null);
                  })
                }
              >
                Deactivate account
              </button>
            </div>
          )}
        </fieldset>
      </section>
    </div>
  );
}
