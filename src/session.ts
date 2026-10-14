export type Account = {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  status: "ACTIVE" | "GUEST" | "DISABLED";
  emailVerified: boolean;
  passwordEnabled: boolean;
  googleLinked: boolean;
};
export type Credentials = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Account;
};
let credentials: Credentials | null = null;
let expiresAt = 0;
let generation = 0;
let controller = new AbortController();
let refreshing: Promise<void> | null = null;
const storageKey = "gather.refresh-token";
const persist = (value: Credentials | null) => {
  if (value) localStorage.setItem(storageKey, value.refreshToken);
  else localStorage.removeItem(storageKey);
};
// Serialize rotating refresh tokens across tabs on HTTPS (and localhost).
const refreshLock = <T>(operation: () => Promise<T>): Promise<T> =>
  navigator.locks.request("gather.refresh", operation);
const listeners = new Set<() => void>();
export const session = {
  get: () => credentials?.user ?? null,
  token: () => credentials?.accessToken,
  refreshToken: () => credentials?.refreshToken,
  storedRefreshToken: () => localStorage.getItem(storageKey),
  async restore(operation: (token: string) => Promise<Credentials>) {
    const epoch = generation;
    return refreshLock(async () => {
      const token = localStorage.getItem(storageKey);
      if (!token) return undefined;
      const next = await operation(token);
      if (epoch !== generation)
        throw new DOMException("Session changed", "AbortError");
      persist(next);
      return next;
    });
  },
  expired: () => Date.now() >= expiresAt - 30000,
  epoch: () => generation,
  signal: () => controller.signal,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(value: Credentials | null) {
    generation++;
    controller.abort();
    controller = new AbortController();
    persist(value);
    credentials = value;
    expiresAt = Date.now() + (value?.expiresIn ?? 0) * 1000;
    if (value) localStorage.setItem("gather.session-used", "true");
    listeners.forEach((fn) => fn());
  },
  profile(user: Account) {
    if (credentials) {
      credentials = { ...credentials, user };
      listeners.forEach((fn) => fn());
    }
  },
  async refresh(operation: (token: string) => Promise<Credentials>) {
    if (refreshing) return refreshing;
    const token = credentials?.refreshToken,
      epoch = generation;
    if (!token) throw new Error("Please sign in again.");
    refreshing = refreshLock(async () => {
      try {
        const currentToken = localStorage.getItem(storageKey);
        if (!currentToken) throw new Error("Please sign in again.");
        const next = await operation(currentToken);
        if (epoch !== generation)
          throw new DOMException("Session changed", "AbortError");
        // Refresh rotates credentials without invalidating concurrent requests.
        persist(next);
        credentials = next;
        expiresAt = Date.now() + next.expiresIn * 1000;
      } catch (error) {
        if (epoch === generation) session.set(null);
        throw error;
      } finally {
        refreshing = null;
      }
    });
    return refreshing;
  },
};

// Signing out in one tab also clears the in-memory account in other tabs.
window.addEventListener("storage", (event) => {
  if (
    (event.key === storageKey || event.key === null) &&
    !localStorage.getItem(storageKey)
  )
    session.set(null);
});
