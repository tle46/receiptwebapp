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
  browserSession?: boolean;
  expiresIn: number;
  user: Account;
};
let credentials: Credentials | null = null;
let expiresAt = 0;
let generation = 0;
let controller = new AbortController();
let refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const session = {
  get: () => credentials?.user ?? null,
  token: () => credentials?.accessToken,
  refreshToken: () => credentials?.refreshToken,
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
    const token = credentials?.browserSession
        ? "cookie"
        : credentials?.refreshToken,
      epoch = generation;
    if (!token) throw new Error("Please sign in again.");
    refreshing = (async () => {
      try {
        const next = await operation(token);
        if (epoch !== generation)
          throw new DOMException("Session changed", "AbortError");
        // Refresh rotates credentials without invalidating concurrent requests.
        credentials = next;
        expiresAt = Date.now() + next.expiresIn * 1000;
      } catch (error) {
        if (epoch === generation) session.set(null);
        throw error;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },
};
