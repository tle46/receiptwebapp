import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const lifetime = 30 * 24 * 60 * 60 * 1000;
export function createGateway({
  backend = "http://localhost:8080",
  origin = "http://localhost:5173",
  dataDir = ".session-data",
  key,
  production = false,
} = {}) {
  const publicOrigin = new URL(origin).origin;
  if (production && (!key || !publicOrigin.startsWith("https://")))
    throw new Error(
      "Production requires SESSION_ENCRYPTION_KEY and HTTPS PUBLIC_ORIGIN.",
    );
  const upstream = new URL(backend);
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    upstream.pathname !== "/" ||
    upstream.username ||
    upstream.password
  )
    throw new Error("BACKEND_URL must be an HTTP(S) origin.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = resolve(dataDir, "development.key");
  if (!key && !existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32).toString("base64"), {
      mode: 0o600,
      flag: "wx",
    });
  const secret = Buffer.from(
    key || readFileSync(keyPath, "utf8").trim(),
    "base64",
  );
  if (secret.length !== 32)
    throw new Error(
      "SESSION_ENCRYPTION_KEY must contain 32 random bytes encoded as Base64.",
    );
  const db = new DatabaseSync(resolve(dataDir, "sessions.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL)",
  );
  const get = db.prepare("SELECT token, expires FROM sessions WHERE id = ?");
  const save = db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM sessions WHERE id = ?");
  const clean = db.prepare("DELETE FROM sessions WHERE expires <= ?");
  const cookieName = publicOrigin.startsWith("https://")
    ? "__Host-splitshare"
    : "splitshare";
  const cookie = (id, expires) =>
    `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expires - Date.now()) / 1000))}${publicOrigin.startsWith("https://") ? "; Secure" : ""}`;
  const hash = (id) => createHash("sha256").update(id).digest("hex");
  function encrypt(token) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", secret, iv);
    return Buffer.concat([
      iv,
      cipher.update(token, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  }
  function decrypt(value) {
    const bytes = Buffer.from(value, "base64"),
      decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(12, -16)),
      decipher.final(),
    ]).toString("utf8");
  }
  const refreshing = new Map();
  // A single gateway process owns this store; concurrent tabs share each rotation.
  function refresh(id) {
    if (refreshing.has(id)) return refreshing.get(id);
    const operation = (async () => {
      const record = get.get(hash(id));
      if (!record || record.expires <= Date.now()) {
        remove.run(hash(id));
        return { status: 401 };
      }
      const response = await fetch(new URL("/api/auth/refresh", upstream), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: decrypt(record.token) }),
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401) remove.run(hash(id));
        return { status: response.status, text };
      }
      const value = JSON.parse(text);
      // Logout can remove the record while a rotation is in flight.
      if (!get.get(hash(id))) return { status: 401 };
      save.run(hash(id), encrypt(value.refreshToken), record.expires);
      return {
        status: 200,
        value: { ...value, refreshToken: "", browserSession: true },
      };
    })().finally(() => refreshing.delete(id));
    refreshing.set(id, operation);
    return operation;
  }
  async function handle(req, res) {
    if (!req.url?.startsWith("/api/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, value) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(value ? JSON.stringify(value) : "");
    };
    // A custom header prevents form/navigation CSRF, and Origin rejects other sites.
    if (
      req.headers["x-splitshare-request"] !== "1" ||
      (req.headers.origin && req.headers.origin !== publicOrigin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      send(403, { message: "Untrusted browser request." });
      return true;
    }
    const id = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const validId = id && /^[a-f0-9]{64}$/.test(id) ? id : null;
    const path = new URL(req.url, publicOrigin).pathname;
    clean.run(Date.now());
    try {
      if (
        (path === "/api/session" && req.method === "GET") ||
        (path === "/api/auth/refresh" && req.method === "POST")
      ) {
        req.resume();
        if (!validId) {
          send(path === "/api/session" ? 204 : 401);
          return true;
        }
        const result = await refresh(validId);
        if (result.status === 401) res.setHeader("Set-Cookie", cookie("", 0));
        if (result.value) send(200, result.value);
        else {
          res.statusCode = result.status;
          res.setHeader("Content-Type", "application/json");
          res.end(result.text || "");
        }
        return true;
      }
      if (path === "/api/session") {
        send(405);
        return true;
      }
      let body = Buffer.alloc(0);
      for await (const chunk of req) {
        body = Buffer.concat([body, chunk]);
        if (body.length > 1024 * 1024) {
          send(413, { message: "Request too large." });
          return true;
        }
      }
      const headers = { Accept: "application/json" };
      if (req.headers.authorization)
        headers.Authorization = req.headers.authorization;
      if (body.length) headers["Content-Type"] = "application/json";
      // Cookies never authenticate or link Google requests at the backend.
      const response = await fetch(new URL(req.url, upstream), {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      if (response.headers.has("retry-after"))
        res.setHeader("Retry-After", response.headers.get("retry-after"));
      let value;
      try {
        value = text ? JSON.parse(text) : undefined;
      } catch {
        /* Preserve non-JSON upstream errors. */
      }
      if (response.ok && value?.refreshToken && value?.accessToken) {
        const nextId = randomBytes(32).toString("hex"),
          expires = Date.now() + lifetime;
        save.run(hash(nextId), encrypt(value.refreshToken), expires);
        if (validId) remove.run(hash(validId));
        res.setHeader("Set-Cookie", cookie(nextId, expires));
        value = { ...value, refreshToken: "", browserSession: true };
      } else if (
        response.ok &&
        ([
          "/api/auth/logout",
          "/api/auth/logout-all",
          "/api/auth/password/change",
          "/api/auth/password/reset",
        ].includes(path) ||
          (path === "/api/auth/me" && req.method === "DELETE"))
      ) {
        if (validId) remove.run(hash(validId));
        res.setHeader("Set-Cookie", cookie("", 0));
      }
      if (value !== undefined) send(response.status, value);
      else {
        res.statusCode = response.status;
        res.setHeader(
          "Content-Type",
          response.headers.get("content-type") || "application/json",
        );
        res.end(text);
      }
    } catch {
      send(502, { message: "Cannot reach the backend. Please try again." });
    }
    return true;
  }
  return { handle, close: () => db.close() };
}
