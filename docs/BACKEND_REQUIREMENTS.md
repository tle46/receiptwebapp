# Account API follow-up

Verified against the running backend on October 5, 2026:

- `GET /api/receipts?userId=...` includes owned receipts and receipts where the selected user participates.
- Participants can fetch shared receipt details in draft status.
- Participant `POST /calculate` requests return 403.
- There is still no login, account lookup, user listing, or user-detail endpoint in the live OpenAPI contract.

## Frontend integration completed

The sidebar separates My receipts, Shared with me, and People. Owned/shared collections use `ownerId === currentUserId`; repeated API rows are deduplicated by receipt ID. Shared detail pages display saved participant balances and item amounts directly from GET responses, including zero balances in drafts. No calculation or mutation request is sent from the participant view. Refresh/focus refetches shared details; a 403 or 404 removes cached details and reloads the list. All requests continue to use the selected user's ID.

Account switching clears receipts, people, editor state, calculations, search, and filters. Session/request guards discard stale reads after account switches. Account controls now live in the top-right header.

## Existing-account access still requires a backend endpoint

The frontend cannot identify an existing account by email or username through the current API. Creating a friend relationship to discover a user would mutate contacts and would not authenticate that user; it is not used as a workaround. The Log in tab accurately states that backend support is missing.

Two possible scopes need a product decision:

1. **Development-only lookup**: read-only lookup by exact email/username returning an active UserResponse. Label the flow as development account selection; it provides no authentication or account security. Never expose a directory of all accounts or claim a verified login.
2. **Real authentication**: add verified signup/sign-in, session handling, logout, account recovery, and server-side authorization derived from the session rather than a caller-controlled userId. Existing passwordless accounts need an ownership verification/claiming flow. All receipt and user/people endpoints must enforce authenticated identity.

No new login endpoints are invented or called by the frontend, and backend reference files are unchanged.

## Other remaining API improvements

- Include participant display names in receipt details so readers do not depend on their own contacts or numeric fallback names.
- Allow verified registration to claim invited-email contacts without losing participant references.
- Actual account deletion requires server support. Remove saved owner only deletes a browser shortcut.

## OCR

On-device English OCR remains available with Tesseract.js 6.0.1 and tessdata_best. Photos are never uploaded. See README for supported formats, review workflow, and accuracy limitations.
