import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createGateway } from "./gateway.mjs";

test("persistent cookies, encrypted storage, serialized rotation, anonymous Google and logout", async (t) => {
  let refreshes = 0,
    validRefresh = "refresh-secret-1",
    revoked = false;
  const received = [];
  const user = {
    id: 7,
    status: "ACTIVE",
    username: "alice",
    displayName: "Alice",
  };
  const credentials = () => ({
    accessToken: "access-secret",
    refreshToken: validRefresh,
    expiresIn: 900,
    user,
  });
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({ path: req.url, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/refresh") {
      refreshes++;
      assert.equal(req.headers.authorization, undefined);
      if (revoked || JSON.parse(body).refreshToken !== validRefresh) {
        res.writeHead(401);
        res.end();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      validRefresh = `refresh-secret-${refreshes + 1}`;
    }
    if (req.url === "/api/auth/logout") {
      revoked = true;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/api/auth/google/nonce") {
      res.end(JSON.stringify({ nonce: "nonce" }));
      return;
    }
    res.end(JSON.stringify(credentials()));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  mkdirSync("test-results", { recursive: true });
  const dataDir = mkdtempSync(resolve("test-results", "session-store-"));
  const options = {
    backend: `http://127.0.0.1:${upstream.address().port}`,
    origin: "https://splitshare.example",
    key: randomBytes(32).toString("base64"),
    dataDir,
    production: true,
  };
  let gateway = createGateway(options);
  const browser = createServer((req, res) => void gateway.handle(req, res));
  await new Promise((resolve) => browser.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    gateway.close();
    await Promise.all([
      new Promise((resolve) => browser.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  });
  const base = `http://127.0.0.1:${browser.address().port}`;
  const call = (
    path,
    { cookie, origin = options.origin, method = "GET", bearer } = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        "X-SplitShare-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });
  assert.equal(
    (
      await call("/api/auth/login", {
        method: "POST",
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/auth/login", { method: "POST" })).status,
    403,
  );
  const login = await call("/api/auth/login", { method: "POST" });
  const value = await login.json();
  assert.equal(value.refreshToken, "");
  assert.equal(value.browserSession, true);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)[1]);
  assert.ok(maxAge >= 2591990 && maxAge <= 2592000);
  assert.ok(!setCookie.includes("refresh-secret"));
  const cookie = setCookie.split(";")[0];
  const responses = await Promise.all([
    call("/api/session", { cookie }),
    call("/api/auth/refresh", { cookie, method: "POST" }),
  ]);
  for (const response of responses)
    assert.equal((await response.json()).accessToken, "access-secret");
  assert.equal(refreshes, 1);
  gateway.close();
  gateway = createGateway(options);
  assert.equal((await call("/api/session", { cookie })).status, 200);
  assert.equal(refreshes, 2);
  for (const suffix of ["", "-wal"]) {
    try {
      assert.ok(
        !readFileSync(resolve(dataDir, `sessions.sqlite${suffix}`)).includes(
          Buffer.from("refresh-secret"),
        ),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await call("/api/auth/google/nonce", { cookie, method: "POST" });
  await call("/api/auth/google", { cookie, method: "POST" });
  assert.equal(
    received.find((r) => r.path === "/api/auth/google/nonce").authorization,
    undefined,
  );
  assert.equal(
    received.find((r) => r.path === "/api/auth/google").authorization,
    undefined,
  );
  // Google login replaces and removes the previous browser session.
  assert.equal((await call("/api/session", { cookie })).status, 401);
  const nextLogin = await call("/api/auth/login", { method: "POST" });
  const nextCookie = nextLogin.headers.get("set-cookie").split(";")[0];
  const logout = await call("/api/auth/logout", {
    cookie: nextCookie,
    method: "POST",
    bearer: "access-secret",
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await call("/api/session", { cookie: nextCookie })).status,
    401,
  );
});
