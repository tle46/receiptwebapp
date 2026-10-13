# SplitShare frontend

React, TypeScript and Vite frontend for the Spring Boot reference in `receipt/`. Backend source is unchanged.

## Run and verify

```sh
npm ci
npm run dev
npm run build
npm test
```

Development proxies `/api` to `http://localhost:8080`. Start the backend with its database and `AUTH_JWT_SECRET` configured. Tests start Vite automatically and use installed Microsoft Edge with mocked API responses; no backend or real provider credentials are needed.

## Accounts and security

First use creates a backend guest account automatically. Registration upgrades that same account in place. Username/password sign-in, sign-out, sign-out on all devices, display-name editing, email verification/resend, password recovery/reset/change, Google sign-in/linking and account deactivation use the documented endpoints. Identity conflicts preserve the existing session. Invited contacts record contact data; no invitation is delivered.

Persistent login is enabled by the same-origin session gateway in `server/`. Login, registration and Google responses set a persistent HttpOnly, SameSite=Strict cookie containing a random session ID. Refresh tokens never enter JavaScript or browser storage: the gateway stores them encrypted with AES-256-GCM in its SQLite database. Access tokens stay in memory. Page loads restore the cookie session before displaying sign-in or creating a first-time guest. Guests also survive reloads and browser restarts, but should register for recovery if cookies are cleared or the session expires.

Refresh rotation is serialized across requests and tabs by one gateway process. The original 30-day expiry is preserved during refresh; it is not extended on every visit. Revoked or expired backend sessions require sign-in again. Successful logout, logout-all, password change/reset and deactivation clear the current cookie and server record. Other revoked sessions are rejected on their next protected request or restoration. Failed logins and Google identity conflicts preserve the current cookie. Anonymous Google sign-in never forwards a cookie as a backend bearer token; registration/linking sends only the explicit access header.

The gateway requires a custom request header and validates the Origin for CSRF protection. Credentials are never written to localStorage/sessionStorage. A localStorage flag remembers prior use so an expired guest is not silently replaced. Legacy local guest data is untouched.

Run `npm run test:server` for cookie flags, CSRF rejection, encrypted storage, persistence through a gateway restart, concurrent rotation, anonymous Google requests and logout checks. The browser suite covers reload restoration, cookie refresh, and logout.

Google requires `VITE_GOOGLE_CLIENT_ID` matching the backend's `GOOGLE_CLIENT_ID`. The frontend requests a server nonce and passes it to Google Identity Services and the exchange endpoint. SMTP and Google failures display provider-unavailable errors. Recovery requires a verified email for password accounts.

## Receipt workflow

Owner drafts support participants, independent equal/exact/percentage/shares item splits, and exact tax/fee/tip overrides. Full draft saves preserve these allocations atomically. Existing drafts autosave after 1.2 seconds; new receipts require Save or Review. Saves serialize, and failed saves remain retryable. Estimates are labeled; server calculation supplies review and final balances.

Owned and shared lists are deduplicated. Participants see saved allocations and balances with no mutation controls or write requests. Owners can calculate/finalize drafts, reopen/settle finalized receipts, and delete draft/finalized receipts. Settled receipts are read-only. Revoked participant access clears details on refresh.

Receipt scanning remains local, using bundled English Tesseract assets. Photos are never uploaded. Review OCR results before saving.

## Deployment

Use Node 24 or newer. `npm run dev` runs the gateway inside Vite automatically. Set `BACKEND_URL` to the Spring Boot origin; it defaults to `http://localhost:8080`. The browser always uses same-origin `/api`. `VITE_API_BASE_URL` is no longer used in browser requests; it is accepted only as a legacy backend-origin fallback for development.

For production:

1. Build with `npm run build`.
2. Configure `PUBLIC_ORIGIN=https://your-frontend.example`, `BACKEND_URL`, and a stable `SESSION_ENCRYPTION_KEY` (32 cryptographically random bytes encoded as Base64). Generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. This is a server secret: never prefix it with `VITE_` or commit it.
3. Set `SESSION_DATA_DIR` to a durable private directory. Preserve it and the key across deploys/restarts. Local development generates a private key automatically in `.session-data/`; production requires the explicit secret. Back up the encrypted store and protect its filesystem access.
4. Run `npm start` and reverse-proxy the entire frontend origin over HTTPS to this server (default `127.0.0.1:3000`). It serves `dist/` and handles `/api`; do not bypass it by proxying auth requests directly to Spring Boot. Production refuses an HTTP public origin and sets Secure cookies.

This SQLite gateway supports one Node process. For multiple gateway instances, replace the store and in-process refresh coordination with a shared store and distributed lock before scaling. [Node SQLite documentation](https://nodejs.org/api/sqlite.html) describes the built-in database API. Configure Google allowed origins, authenticated SMTP, trusted proxies/gateway rate limits, backup/migrations, and backend production schema validation as described in `receipt/docs/`. The backend's per-socket IP abuse limits will see the gateway address unless trusted proxy handling is configured.

Use a Content Security Policy appropriate to hosting, including Google's script/frame/connect origins if enabled and the worker/WebAssembly requirements for OCR. Set HSTS, nosniff and a restrictive referrer policy at the proxy.

The live local Swagger endpoint was unavailable during this integration. Request shapes were checked against supplied Java DTOs/controllers. Creation requires receipt/item totals; bulk draft save does not. Owner participant IDs are excluded from bulk participant lists but retained in item allocations. Zero allocation inputs are omitted as required by backend validation.

Before release, smoke-test a configured staging backend: real Google nonce exchange, SMTP verification/recovery, receipt roundtrips and lifecycle, token revocation, CORS and HTTPS. Mocked browser tests do not verify provider configuration or database behavior. Smoke-test persistent restoration and logout through the deployed gateway.
