# SplitShare frontend

React, TypeScript and Vite frontend for the Spring Boot reference in `receipt/`. The frontend deploys as static assets; the Spring Boot backend runs separately.

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

Authentication calls the backend directly with bearer access tokens held in memory. The rotating refresh token is stored in localStorage and restores login after reloads, closed tabs, and browser restarts, until the backend session expires (currently 30 days from sign-in) or is revoked. Refresh tokens are accessible to JavaScript; there is no HttpOnly cookie or frontend session server. A localStorage flag remembers prior use so an expired guest is not silently replaced. Guests should register to recover access if browser data is cleared.

Refresh requests across tabs are serialized with the Web Locks API (requires HTTPS or localhost). Signing out in one tab clears the account in other tabs. Logout, logout-all, password changes and deactivation clear the saved credentials. Expired/revoked refresh tokens return the user to sign-in. Temporary restoration failures keep the stored refresh token for a retry. Existing gateway cookie sessions cannot migrate; users must sign in again after this update.

Google requires `VITE_GOOGLE_CLIENT_ID` matching the backend's `GOOGLE_CLIENT_ID`. The frontend requests a server nonce and passes it to Google Identity Services and the exchange endpoint. SMTP and Google failures display provider-unavailable errors. Recovery requires a verified email for password accounts.

## Balances and recorded payments

Balances is available in the sidebar. `GET /api/users/{authenticatedUserId}/balances` supplies currency-specific gross incoming debt, outgoing debt, and informational net amounts. People are named from the balance response, including people who are no longer contacts. Amounts from different currencies are never added or offset; money comparisons use integer cents. An empty currency list shows a no-outstanding-balances state. Zero net with gross debt in both directions is explicitly labeled as outstanding.

Mark all received confirms all incoming amounts for the person across all currencies and calls `POST /api/users/{authenticatedUserId}/balances/people/{personUserId}/settle`. It never clears money the current user owes that person and never transfers funds. The response is used for a receipt/count summary; balances and receipt lists are refetched, and any affected open receipt is reloaded. Duplicate submissions are locked. Empty settlement results are successful and refresh the page.

Owner receipt details show original participant shares alongside Draft, Paid, or Unpaid status. Mark received calls the participant settlement endpoint using the receipt participant record ID, not the user ID. The full response updates the receipt immediately, including automatic SETTLED status when the last outstanding share is paid. Paid amounts remain visible at their original value. Participants see payment status read-only. Owners can still mark all participants received with the existing receipt settlement action.

A finalized receipt with any paid non-owner positive share cannot be reopened or deleted. Those controls are hidden, and the handlers guard the restriction. Owners can reverse all receipt payments using `POST /api/receipts/{receiptId}/unsettle?userId={currentUserId}` with no body. The full response determines status and payment flags; owner and zero shares remain settled. Receipt lists and balances refresh after reversal. Drafts create no balances and cannot record or reverse payments.

The local Swagger schema inspected on October 12, 2026 still lacked balances, participant settlement, and participant `settled` fields. This integration follows the pasted **Balances and settlement frontend handoff**. Run the updated backend before using these features live; the older running backend returns unavailable/not-found errors. Browser tests mock the new contract and do not establish that the updated backend has been deployed.

## Receipt workflow

Owner drafts support participants, independent equal/exact/percentage/shares item splits, and exact tax/fee/tip overrides. Full draft saves preserve these allocations atomically. Existing drafts autosave after 1.2 seconds; new receipts require Save or Review. Saves serialize, and failed saves remain retryable. Estimates are labeled; server calculation supplies review and final balances.

Owned and shared lists are deduplicated. Participants see saved allocations and balances with no mutation controls or write requests. Owners can calculate/finalize drafts, reopen/settle finalized receipts, and delete draft/finalized receipts. Settled receipts are read-only. Revoked participant access clears details on refresh.

Receipt scanning remains local, using bundled English Tesseract assets. Photos are never uploaded. Review OCR results before saving.

## Deployment on Cloudflare Pages

Connect the `receiptwebapp` repository to Pages and configure:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root (use `receiptwebapp` only if deploying from a parent repository).
- Build environment: `VITE_API_BASE_URL=https://your-backend.example` (origin only, without `/api`) and optionally `VITE_GOOGLE_CLIENT_ID`.
- Node version: 24 or newer (set `NODE_VERSION=24`).

Vite embeds `VITE_` values at build time; rebuild after changing them. They are public and must never contain secrets. Pages serves the static SPA directly; no Node server, SQLite store, Pages Functions, or session encryption key is needed. See [Cloudflare's React Pages guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).

Deploy the Spring Boot backend separately over HTTPS. Set its `CORS_ALLOWED_ORIGIN` to the exact frontend origin, such as `https://splitshare.pages.dev` or your custom domain. The current backend accepts one origin; Pages preview URLs need their own backend CORS configuration. Configure Google's authorized JavaScript origins to match the frontend as well. Keep `AUTH_JWT_SECRET`, database credentials, Google secrets, and SMTP credentials on the backend.

For local development, leave `VITE_API_BASE_URL` empty and set `BACKEND_URL` for Vite's `/api` proxy (default `http://localhost:8080`). `npm run preview` also uses this proxy when no public API origin was built in. Old `PUBLIC_ORIGIN`, `SESSION_DATA_DIR`, and `SESSION_ENCRYPTION_KEY` settings are unused. Existing `.session-data` files are no longer read.
