import { useEffect, useState, useSyncExternalStore } from "react";
import { auth } from "./api";
import { session } from "./session";
import App from "./App";
import AccountPanel from "./AccountPanel";
let onboarding: Promise<void> | null = null;
let restoring: Promise<void> | null = null;
function restoreSession() {
  if (!restoring)
    restoring = (async () => {
      const value = await auth.restore();
      if (value?.user && value.accessToken) session.set(value);
      else if (!localStorage.getItem("gather.session-used")) await startGuest();
    })().finally(() => {
      restoring = null;
    });
  return restoring;
}
function startGuest() {
  if (!onboarding)
    onboarding = auth
      .guest()
      .then((value) => session.set(value))
      .finally(() => {
        onboarding = null;
      });
  return onboarding;
}
export default function SessionApp() {
  const account = useSyncExternalStore(session.subscribe, session.get);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function guest() {
    setLoading(true);
    setError("");
    try {
      await startGuest();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot start guest session.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void restoreSession()
      .catch((error) =>
        setError(
          error instanceof Error
            ? error.message
            : "Could not restore your session.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  if (account)
    return <App key={`${account.id}:${session.epoch()}`} account={account} />;
  return (
    <main className="session-screen entry-page">
      <header className="entry-brand">
        <h1>SplitShare</h1>
        <p className="brand-subtitle">
          Split and share receipts with your friends!
        </p>
      </header>
      <div className="entry-card">
        <section className="guest-entry" aria-labelledby="guest-entry-title">
          <h2 id="guest-entry-title">Start splitting in seconds</h2>
          <p>
            No sign-up needed. Add your receipt and choose who shares each item.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary guest-continue"
            disabled={loading}
            onClick={() => void guest()}
          >
            {loading
              ? "Starting your workspace..."
              : "Continue without an account"}
            <span aria-hidden="true">&rarr;</span>
          </button>
        </section>
        <div className="entry-divider">
          <span>or use an account</span>
        </div>
        <AccountPanel embedded />
      </div>
      <footer className="entry-footer">
        <div className="footer-credit">
          <span>Created by Thomas Le</span>
          <span>Copyright © 2026 Thomas Le. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
